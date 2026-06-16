# LeetGFGHub

> Automatically sync LeetCode and GeeksForGeeks solutions to GitHub.

[![Build Status](https://github.com/abhinay1376/leetgfghub/actions/workflows/build.yml/badge.svg)](https://github.com/abhinay1376/leetgfghub/actions/workflows/build.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Contributions Welcome](https://img.shields.io/badge/contributions-welcome-brightgreen.svg?style=flat)](https://github.com/abhinay1376/leetgfghub/issues)

LeetGFGHub is a premium Chrome Extension that seamlessly synchronizes your accepted LeetCode and GeeksForGeeks submissions directly to your GitHub repository. It acts as your personal portfolio builder, automatically organizing your code, generating comprehensive READMEs, and providing a beautiful analytics dashboard to track your progress.

## ✨ Features

- **Automated Sync:** Pushes accepted solutions from LeetCode and GeeksForGeeks to GitHub instantly.
- **Smart Organization:** Creates a structured directory for each problem, standardizing naming conventions.
- **Rich README Generation:** Automatically creates problem-specific READMEs with difficulty, platform, date, and code.
- **Advanced Analytics Dashboard:** Track your daily solves, streaks, difficulty distribution, and language usage.
- **Contribution Heatmap:** A GitHub-style heatmap visualizes your coding activity over time.
- **GitHub as the Source of Truth:** Your data is backed up to GitHub (`.dsa-sync/`). Easily restore analytics if you change devices.
- **Premium UI:** A stunning, Apple-inspired interface with Dark/Light modes and glassmorphism.

## 🚀 Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/abhinay1376/leetgfghub.git
   ```
2. Open Chrome and navigate to `chrome://extensions/`.
3. Enable **Developer mode** in the top right corner.
4. Click **Load unpacked** and select the `leetgfghub` directory.

*(Coming soon to the Chrome Web Store!)*

## ⚙️ Configuration & GitHub Setup

1. Create a new GitHub repository (e.g., `dsa-solutions`).
2. Generate a [GitHub Personal Access Token (Classic)](https://github.com/settings/tokens) with `repo` scope.
3. Open the LeetGFGHub extension.
4. Enter your GitHub Username, Personal Access Token, and Repository URLs.
5. Click **Verify Connection** to ensure everything is set up correctly.

## 🔄 Restore from Repository

Changed computers or reinstalled the extension? No problem!
1. Set up your token and repository URLs in the Settings tab.
2. Scroll to **Repository Sync** and click **Restore**.
3. LeetGFGHub will scan your repository and instantly rebuild your dashboard and streaks.

## 🤝 Contributing

We welcome contributions from the community! Please read our [Contributing Guide](CONTRIBUTING.md) to learn how to get started. Don't forget to check our [Code of Conduct](CODE_OF_CONDUCT.md).

## 🗺️ Roadmap

See what's planned for the future in our [Roadmap](ROADMAP.md).

## 🐛 Troubleshooting

- **401 Bad Credentials:** Ensure your GitHub Personal Access Token is valid and has `repo` permissions.
- **Missing Folders:** Verify that the folder paths in Settings match your repository structure exactly.

## 📜 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## ⭐️ Support

If you find this project helpful, please consider giving it a star on GitHub! It helps more people discover the tool.
