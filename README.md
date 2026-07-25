# Google Classroom (GCR) Task & Deadline Reminder System

An elegant, modern dark-themed web application designed for students and scholars to easily manage assignment deadlines. The system supports custom task creation, setting warning thresholds, visual countdowns, Kanban board planning, monthly calendars, and desktop push and synthesized sound alerts.

## Features

- 🌟 **Sleek Dark glassmorphic Dashboard**: A premium, responsive user interface with statistics widgets.
- 🔄 **Google Classroom (GCR) Sync Simulator**: Realistic authorization steps, loading feedback, and automatic roster/assignment importing.
- 🕒 **Real-time Deadline Timers**: Every task features a live, color-coded countdown indicating the remaining hours/minutes/seconds.
- 📋 **Multiple Views**:
  - **List View**: Detailed scrollable layout with search/filter features.
  - **Kanban Board**: Drag-and-drop or simple click-based column organization (Pending, In Progress, Completed).
  - **Calendar View**: A complete interactive monthly grid with day-cell indicators and a schedule expander panel.
- 🔊 **Dynamic Sound Synthesizer (Web Audio API)**: Sound alarms are generated directly in the browser using oscilators—no audio assets required!
- 🔔 **System Toast & Push Notification System**: Full browser permissions prompt and desktop notifications.
- 💾 **Local Storage Persistence**: Safely saves task histories, connection status, and configuration preferences on your local browser.

## Tech Stack
- HTML5 (Semantic elements)
- CSS3 (Vanilla CSS variables, Flexbox, Grid, custom keyframe transitions)
- JavaScript (ES6+, Web Audio API, Web Notification API, LocalStorage, Drag and Drop API)

## How to Run

Since the application is written entirely in Vanilla HTML/CSS/JS, it runs directly in the browser and requires no compile steps.

You can launch a local web server using Python's built-in module:

1. Open your terminal in this repository.
2. Run the server:
   ```bash
   python3 -m http.server 8000
   ```
3. Open [http://localhost:8000](http://localhost:8000) in your web browser.

---

### Verification and Demonstration Tips
1. **Onboarding Demo Task**: When you load the page for the first time, a demo task is automatically created that expires **5 minutes in the future**. Wait for this task to count down to zero to test the visual warning toasts, synthesized bell chime, and desktop overlay alerts.
2. **Google Classroom Sync**: Click **Sync Classroom** in the left sidebar. Walk through the mock Google OAuth authorization screens, select the classes you want to track, and import them. They will immediately show up on your calendar and Kanban boards with dynamically computed countdowns relative to the current time.
3. **Sound Alerts**: You can toggle sound and browser alerts on and off from the bottom of the sidebar. When toggled on, it will play a preview chime to verify your browser's audio permissions context is active.
