//! OpenVI's local index: one SQLite database per game folder, holding the resources of every scanned archive.
//!
//! Archives have no readable table of contents, so their content is found by scanning once (`openvi-formats`); the
//! index keeps the result so searches across the whole game answer at once. Names are searched with FTS5's trigram
//! tokenizer: any part of a name matches, not only whole words.

use std::path::Path;

use anyhow::Result;
use openvi_formats::ArchiveScan;
use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;

/// Bumped when the schema changes; an index with another version is rebuilt (it is only a cache of scans).
const SCHEMA_VERSION: i64 = 1;

const SCHEMA: &str = "
    CREATE TABLE archives (
        id INTEGER PRIMARY KEY,
        path TEXT NOT NULL UNIQUE,
        size INTEGER NOT NULL,
        mtime INTEGER NOT NULL,
        coverage REAL NOT NULL
    );
    CREATE TABLE resources (
        id INTEGER PRIMARY KEY,
        archive_id INTEGER NOT NULL REFERENCES archives(id),
        offset INTEGER NOT NULL,
        size INTEGER NOT NULL,
        type_name TEXT NOT NULL,
        name TEXT
    );
    CREATE INDEX resources_by_archive ON resources(archive_id);
    CREATE VIRTUAL TABLE resource_names USING fts5(name, tokenize = 'trigram');
";

/// One resource found by a search.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Hit {
    /// The archive's path from the game folder, forward slashes.
    pub archive: String,
    pub offset: u64,
    /// Bytes once inflated.
    pub size: u64,
    pub type_name: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResults {
    /// Best matches first: exact name, then names starting with the query, then shorter names.
    pub hits: Vec<Hit>,
    /// More resources matched than the limit allowed.
    pub truncated: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub archives: u64,
    pub resources: u64,
    pub named: u64,
}

pub struct Index {
    connection: Connection,
}

impl Index {
    /// Opens the index at `path`, creating it (or rebuilding it after a schema change).
    pub fn open(path: &Path) -> Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let connection = Connection::open(path)?;
        // WAL lets searches read while an indexing pass writes.
        connection.pragma_update(None, "journal_mode", "WAL")?;
        connection.pragma_update(None, "synchronous", "NORMAL")?;
        let version: i64 = connection.pragma_query_value(None, "user_version", |row| row.get(0))?;
        if version != SCHEMA_VERSION {
            connection.execute_batch(
                "DROP TABLE IF EXISTS resource_names; DROP TABLE IF EXISTS resources; DROP TABLE IF EXISTS archives;",
            )?;
            connection.execute_batch(SCHEMA)?;
            connection.pragma_update(None, "user_version", SCHEMA_VERSION)?;
        }
        Ok(Self { connection })
    }

    /// Whether `archive` is indexed as it is on disk now.
    pub fn is_current(&self, archive: &str, size: u64, mtime: u64) -> Result<bool> {
        let stored: Option<(i64, i64)> = self
            .connection
            .query_row("SELECT size, mtime FROM archives WHERE path = ?1", [archive], |row| {
                Ok((row.get(0)?, row.get(1)?))
            })
            .optional()?;
        Ok(stored == Some((size as i64, mtime as i64)))
    }

    /// Replaces what the index holds for `archive` with `scan`.
    pub fn store(&mut self, archive: &str, size: u64, mtime: u64, scan: &ArchiveScan) -> Result<()> {
        let transaction = self.connection.transaction()?;
        let previous: Option<i64> = transaction
            .query_row("SELECT id FROM archives WHERE path = ?1", [archive], |row| row.get(0))
            .optional()?;
        if let Some(id) = previous {
            transaction.execute(
                "DELETE FROM resource_names WHERE rowid IN (SELECT id FROM resources WHERE archive_id = ?1)",
                [id],
            )?;
            transaction.execute("DELETE FROM resources WHERE archive_id = ?1", [id])?;
            transaction.execute("DELETE FROM archives WHERE id = ?1", [id])?;
        }
        transaction.execute(
            "INSERT INTO archives (path, size, mtime, coverage) VALUES (?1, ?2, ?3, ?4)",
            params![archive, size as i64, mtime as i64, scan.coverage],
        )?;
        let archive_id = transaction.last_insert_rowid();
        {
            let mut resource = transaction.prepare(
                "INSERT INTO resources (archive_id, offset, size, type_name, name) VALUES (?1, ?2, ?3, ?4, ?5)",
            )?;
            let mut name = transaction.prepare("INSERT INTO resource_names (rowid, name) VALUES (?1, ?2)")?;
            for entry in &scan.entries {
                resource.execute(params![
                    archive_id,
                    entry.offset as i64,
                    entry.size as i64,
                    entry.type_name(),
                    entry.name
                ])?;
                if let Some(text) = &entry.name {
                    name.execute(params![transaction.last_insert_rowid(), text])?;
                }
            }
        }
        transaction.commit()?;
        Ok(())
    }

    /// Named resources whose name contains `query` (case-insensitive), at most `limit`.
    pub fn search(&self, query: &str, limit: usize) -> Result<SearchResults> {
        let query = query.trim();
        if query.is_empty() {
            return Ok(SearchResults {
                hits: Vec::new(),
                truncated: false,
            });
        }
        // Trigrams need three characters; shorter queries scan the names instead.
        let (filter, pattern) = if query.chars().count() >= 3 {
            (
                "r.id IN (SELECT rowid FROM resource_names WHERE resource_names MATCH ?1)",
                format!("\"{}\"", query.replace('"', "\"\"")),
            )
        } else {
            (
                "r.name LIKE ?1 ESCAPE '\\'",
                format!(
                    "%{}%",
                    query.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_")
                ),
            )
        };
        let sql = format!(
            "SELECT a.path, r.offset, r.size, r.type_name, r.name
             FROM resources r JOIN archives a ON a.id = r.archive_id
             WHERE {filter}
             ORDER BY r.name = ?2 COLLATE NOCASE DESC, r.name LIKE ?3 ESCAPE '\\' DESC, length(r.name), r.name, a.path
             LIMIT ?4"
        );
        let prefix = format!(
            "{}%",
            query.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_")
        );
        let mut statement = self.connection.prepare(&sql)?;
        let mut hits = statement
            .query_map(params![pattern, query, prefix, (limit + 1) as i64], |row| {
                Ok(Hit {
                    archive: row.get(0)?,
                    offset: row.get::<_, i64>(1)? as u64,
                    size: row.get::<_, i64>(2)? as u64,
                    type_name: row.get(3)?,
                    name: row.get(4)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        let truncated = hits.len() > limit;
        hits.truncate(limit);
        Ok(SearchResults { hits, truncated })
    }

    pub fn status(&self) -> Result<Status> {
        Ok(self.connection.query_row(
            "SELECT (SELECT count(*) FROM archives), (SELECT count(*) FROM resources),
                    (SELECT count(*) FROM resources WHERE name IS NOT NULL)",
            [],
            |row| {
                Ok(Status {
                    archives: row.get::<_, i64>(0)? as u64,
                    resources: row.get::<_, i64>(1)? as u64,
                    named: row.get::<_, i64>(2)? as u64,
                })
            },
        )?)
    }
}

#[cfg(test)]
mod tests {
    use openvi_formats::{ArchiveEntry, ResourceKind};

    use super::*;

    fn resource(offset: u64, name: Option<&str>, resource_type: Option<&str>) -> ArchiveEntry {
        ArchiveEntry {
            offset,
            compressed_size: 10,
            size: 100,
            kind: ResourceKind::RageObject,
            sub_type: String::new(),
            extension: "rsc".into(),
            name: name.map(str::to_owned),
            resource_type: resource_type.map(str::to_owned),
        }
    }

    fn scan(entries: Vec<ArchiveEntry>) -> ArchiveScan {
        ArchiveScan { entries, coverage: 0.5 }
    }

    fn temp_index(test: &str) -> (Index, std::path::PathBuf) {
        let dir = std::env::temp_dir().join(format!("openvi-index-{test}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        (Index::open(&dir.join("index.sqlite")).unwrap(), dir)
    }

    fn names(results: &SearchResults) -> Vec<&str> {
        results.hits.iter().map(|hit| hit.name.as_str()).collect()
    }

    #[test]
    fn finds_names_by_any_part_best_matches_first() {
        let (mut index, dir) = temp_index("search");
        index
            .store(
                "levels.rpf",
                1,
                1,
                &scan(vec![
                    resource(0x10, Some("prop_bench_01"), Some("dr")),
                    resource(0x20, Some("bench"), Some("ft")),
                    resource(0x30, Some("bench_park_long"), Some("dr")),
                    resource(0x40, Some("car_door"), Some("dr")),
                    resource(0x50, None, None),
                ]),
            )
            .unwrap();
        index
            .store(
                "pack/story000/story000.rpf",
                1,
                1,
                &scan(vec![resource(0x60, Some("BENCHMARK"), None)]),
            )
            .unwrap();

        let results = index.search("bench", 10).unwrap();
        let status = index.status().unwrap();
        let short = index.search("_d", 10).unwrap();
        let limited = index.search("bench", 2).unwrap();
        drop(index);
        std::fs::remove_dir_all(&dir).unwrap();

        assert_eq!(
            names(&results),
            ["bench", "BENCHMARK", "bench_park_long", "prop_bench_01"]
        );
        assert_eq!(results.hits[0].type_name, "Fragment");
        assert_eq!(results.hits[1].archive, "pack/story000/story000.rpf");
        assert_eq!(names(&short), ["car_door"]);
        assert!(limited.truncated && limited.hits.len() == 2);
        assert_eq!(
            status,
            Status {
                archives: 2,
                resources: 6,
                named: 5
            }
        );
    }

    #[test]
    fn storing_an_archive_again_replaces_its_resources() {
        let (mut index, dir) = temp_index("replace");
        index
            .store("common.rpf", 10, 1, &scan(vec![resource(0x10, Some("old_name"), None)]))
            .unwrap();
        let before = index.is_current("common.rpf", 10, 1).unwrap();
        index
            .store("common.rpf", 20, 2, &scan(vec![resource(0x10, Some("new_name"), None)]))
            .unwrap();

        let stale = index.is_current("common.rpf", 10, 1).unwrap();
        let old = index.search("old_name", 10).unwrap();
        let new = index.search("new_name", 10).unwrap();
        let status = index.status().unwrap();
        drop(index);
        std::fs::remove_dir_all(&dir).unwrap();

        assert!(before && !stale);
        assert!(old.hits.is_empty());
        assert_eq!(names(&new), ["new_name"]);
        assert_eq!(status.resources, 1);
    }
}
