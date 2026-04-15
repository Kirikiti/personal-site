# 📇 Personal Networking CRM

A lightweight, privacy-focused CRM that runs entirely in your browser and saves data to your own Google Drive. No servers, no tracking, total control.

## ✨ Key Features
- **Total Privacy**: Your data never leaves your browser/Google Drive.
- **Urgency System**: Visual indicators (Red/Yellow/Green) for follow-ups.
- **Full Text Search**: Find contacts by tags, company, or name.
- **Interactions History**: Keep a log of every conversation.

---

## 🛡️ Privacy & Security (Important)

This project was built with **Privacy by Design** principles:

- **Google Drive Storage**: All information is stored in a single file named `networking_crm.json` in your personal Drive.
- **Restricted Scopes**: This app uses the `drive.file` OAuth scope. This means it **cannot** read any other files in your Google Drive—only the ones it creates.
- **Zero Backend**: There is no database or server-side code. The developer cannot see your contacts or your data.

## ⚠️ Disclaimer

*This is a personal, non-commercial open-source project. **Use it at your own risk.***
The software is provided "as is", without warranty of any kind. The developer is not responsible for any data loss, corruption, or unauthorized access resulting from software vulnerabilities, third-party breaches, or user account compromise.

---

## 🚀 Getting Started

1. **Clone the repo**: `git clone https://github.com`
2. **Google Setup**: Create a project in [Google Cloud Console](https://google.com).
3. **Configure**: Add your `CLIENT_ID` and `API_KEY` in the `index.html` file.
4. **Run**: Open `index.html` in your browser.

---
