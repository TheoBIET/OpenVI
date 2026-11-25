//! Progress of the long operations behind the catalog sections and their previews: one event per step, with a count
//! when there is one, so the frontend's bar always says what is going on (`catalog-progress`).

use openvi_formats::ScanPhase;
use serde::Serialize;
use tauri::{AppHandle, Emitter};

/// Event the steps are sent as.
pub const PROGRESS_EVENT: &str = "catalog-progress";

/// One step: what is going on, and how far (`total` 0: no count, the bar shows activity only).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Step {
    pub label: String,
    pub done: u64,
    pub total: u64,
    /// `done` and `total` are bytes (else items).
    pub bytes: bool,
}

/// Sends steps to the frontend; silent in tests.
#[derive(Clone)]
pub struct Reporter(Option<AppHandle>);

impl Reporter {
    pub fn new(app: AppHandle) -> Self {
        Self(Some(app))
    }

    #[cfg(test)]
    pub fn silent() -> Self {
        Self(None)
    }

    fn send(&self, step: Step) {
        if let Some(app) = &self.0 {
            // A closed window cannot receive progress; the work goes on.
            let _ = app.emit(PROGRESS_EVENT, step);
        }
    }

    /// A step without a count.
    pub fn step(&self, label: impl Into<String>) {
        self.send(Step {
            label: label.into(),
            done: 0,
            total: 0,
            bytes: false,
        });
    }

    /// A step counted in items.
    pub fn count(&self, label: impl Into<String>, done: u64, total: u64) {
        self.send(Step {
            label: label.into(),
            done,
            total,
            bytes: false,
        });
    }

    /// A step counted in bytes.
    pub fn bytes(&self, label: impl Into<String>, done: u64, total: u64) {
        self.send(Step {
            label: label.into(),
            done,
            total,
            bytes: true,
        });
    }

    /// The step of a scan of `archive`, as `scan_archive` reports it.
    pub fn scan(&self, archive: &str, phase: ScanPhase, done: u64, total: u64) {
        let (label, bytes) = match phase {
            ScanPhase::Carving => (format!("Scanning {archive}: finding resources"), true),
            ScanPhase::Naming => (format!("Scanning {archive}: reading their names"), false),
        };
        self.send(Step {
            label,
            done,
            total,
            bytes,
        });
    }

    /// A callback for `scan_archive` reporting its steps for `archive`.
    pub fn scanning(&self, archive: &'static str) -> impl Fn(ScanPhase, u64, u64) + Send + Sync + 'static {
        let reporter = self.clone();
        move |phase, done, total| reporter.scan(archive, phase, done, total)
    }
}
