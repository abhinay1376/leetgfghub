# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Complete open-source project structure with GitHub Actions, issue templates, and contributing guidelines.
- "Restore from Repository" capability: Dashboard, analytics, and streaks are now rebuilt from the GitHub repository (`.dsa-sync/`).
- "About" page in the extension popup.
- First Run Experience / Welcome Screen.
- Direct links to report issues and star the repository.

### Changed
- Project name updated to **LeetGFGHub**.
- Overhauled UI with Apple-inspired design (glassmorphism, soft shadows, sleek dark/light mode).
- Improved LeetCode & GFG solution code extraction for better reliability.

### Fixed
- Stabilized `MutationObserver` to prevent race conditions during repeated submissions.
- Fixed Git SHA mismatch issues during sequential pushes by enforcing fresh metadata checks.
- Resolved folder name generation edge cases.

## [2.0.0] - 2026-06-16

### Added
- Multi-repository support (separate configuration for LeetCode and GeeksForGeeks).
- Advanced Analytics Dashboard with contribution heatmap and language stats.
- Auto-detection of existing repository folders.

### Changed
- Migrated entirely to Manifest V3.

## [1.0.0] - 2024-XX-XX

### Added
- Initial release.
- Basic syncing of LeetCode and GeeksForGeeks accepted solutions to GitHub.
