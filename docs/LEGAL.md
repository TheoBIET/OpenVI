# Legal notes

OpenVI is an independent, clean-room tool for inspecting files you own, built for interoperability and research.
These rules apply to every contribution.

## What OpenVI does

- It reads the folders and files of an install **you supply**, on your machine.
- It decodes **unencrypted** data only. Encrypted blocks (the RPF9 table of contents, compiled scripts, some string
  blocks) are skipped untouched.
- Exports (models, textures, data) are written to your machine for your own use.

## What OpenVI never contains

- Decryption routines, encryption keys, or anything that circumvents an access-control or anti-tamper measure.
- Game files or anything extracted from them: archives, executables, models, textures, audio, video, text dumps.
  Test fixtures are synthetic bytes written for the test.
- Code or documentation from a console SDK.
- Network features that upload or share game content.

## Trademarks

OpenVI is not affiliated with, endorsed by or sponsored by Rockstar Games, Take-Two Interactive, Microsoft or the
OpenIV team. Names and trademarks belong to their owners. The project uses no official logo or typeface.

## Takedown and legal contact

If you believe something in this repository infringes your rights, open a report through the repository's
**Security → Report a vulnerability** form: it reaches the maintainer privately, and it will be handled promptly.
