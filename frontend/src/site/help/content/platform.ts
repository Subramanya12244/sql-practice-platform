import type { HelpContentModule } from "../types";

/** The platform guide: shown on the home page, settings and any page without its own help; also the first-visit tour of the shell. */
const mod: HelpContentModule = {
  sections: [
    {
      id: "platform",
      title: "DataForge basics",
      blurb: "How the site is laid out, where to start, and how your progress is kept.",
      icon: "compass",
      routes: ["/", "/settings", "/account", "/login", "/signup", "/reset-password"],
      home: "/",
      keywords: ["start", "getting started", "welcome", "overview", "navigation", "sidebar", "menu", "progress", "sign in", "account", "theme", "dark mode", "light mode", "search", "onboarding", "tour"],
      overview: {
        what: "DataForge is a place to practise SQL, Python and data engineering on real data that runs in your browser. Nothing to install.",
        why: "Data analyst and data engineer interviews test whether you can write and reason about code, not just read about it. You get graded practice, short lessons and projects in one place.",
        when: "Start here if you are new, or any time you are not sure which section to open next.",
      },
      canDo: [
        "Follow the Daily Learning programme: one planned lesson a day, a common core first, then an Analyst or Engineer path.",
        "Practise graded SQL questions and Python problems that run in your browser.",
        "Build ETL pipelines, data quality checks and guided projects.",
        "Read notes, patterns, mind maps and cheat sheets, then test yourself with flashcards.",
        "Track what you solved, what you got wrong and how much you studied.",
      ],
      howTo: [
        "Pick a route: Daily Learning for a structured plan, or Practice to jump straight into questions.",
        "Open a lesson or question and read the problem before you touch the editor.",
        "Write your answer in the editor, run it, and read the result or the error.",
        "Submit to get it graded. If it fails, read what the checker says, fix it and try again.",
        "Come back tomorrow. Your streak, solved list and study time update as you work.",
      ],
      controls: [
        { name: "Sidebar / Open menu", what: "On desktop the Sidebar, on a phone the Open menu button in the top bar. Both group every section: Dashboard, Daily Learning, Learn, Practice, Projects, Intelligence, Career and Community.", tip: "On a phone, open the menu button in the top bar and tap a group to expand it." },
        { name: "Search (Ctrl+K or /)", what: "Finds notes, patterns, mind maps, concept guides, shortcuts and questions.", tip: "Press / anywhere outside a text box to open it." },
        { name: "? Help", what: "Opens help for the page you are on: what it does, how to use it, a worked example, and a guided tour.", tip: "Press ? (Shift + /) outside a text box for the same thing." },
        { name: "Toggle light or dark theme", what: "The sun or moon button. Switches between the light and dark theme. The choice is remembered on this device." },
        { name: "Sign in", what: "Optional. Signing in keeps your progress with your account instead of only in this browser." },
      ],
      mistakes: [
        { mistake: "Clearing browser data and expecting progress to survive.", fix: "Progress is stored in your browser. Sign in so it is also kept with your account." },
        { mistake: "Jumping into hard questions first.", fix: "Start with Daily Learning day 1, or filter Practice by Easy, and build up." },
        { mistake: "Reading the solution before trying.", fix: "Attempt first, use hints in order, and view the solution last. Your attempts feed Mistake Notebook and Analytics." },
      ],
      tips: [
        "Ctrl/Cmd + Enter runs the code in any code editor.",
        "? opens Help, / opens Search, Esc closes either.",
        "Every help panel has a Start tour button; finished tours are remembered and you can restart them any time.",
        "Settings holds the options to replay the welcome tour and reset tour progress.",
      ],
      related: [
        { label: "Daily Learning", to: "/daily", why: "A planned lesson every day" },
        { label: "SQL practice", to: "/questions", why: "Graded questions on real PostgreSQL" },
        { label: "Python practice", to: "/practice/python", why: "Problems that run in your browser" },
        { label: "Projects lab", to: "/projects-lab", why: "Guided end-to-end projects" },
      ],
      recommendations: [
        { label: "Start Daily Learning at Day 1", to: "/daily/day/1", why: "Python from scratch, no experience needed" },
        { label: "Learning dashboard", to: "/learn", why: "Goals, streak and what to do next" },
        { label: "Try the SQL playground", to: "/playground", why: "Run any query on a practice database" },
      ],
      tour: {
        id: "platform",
        title: "A quick tour of DataForge",
        steps: [
          { id: "welcome", title: "Welcome to DataForge", body: "This 5-step tour shows how to move around. You can leave at any time.", how: "Press Next, or the right-arrow key." },
          { id: "sidebar", title: "Every section lives in the sidebar", body: "Dashboard, Daily Learning, Learn, Practice, Projects and more. The group holding the current page opens automatically.", how: "Click a group to expand it, then pick a page. On a phone, tap the menu button in the top bar.", target: ["aside[aria-label=\"Sidebar\"]", "button[aria-label=\"Open menu\"]"] },
          { id: "search", title: "Search finds content fast", body: "Search notes, patterns, questions and shortcuts by name or idea.", how: "Click Search or press Ctrl+K (Cmd+K on a Mac).", target: ["button[aria-label=\"Search (Ctrl+K)\"]", "button[aria-label=\"Search\"]"] },
          { id: "theme", title: "Light or dark", body: "Pick the theme that is easier on your eyes. It is remembered on this device.", how: "Click the sun or moon icon.", target: ["button[aria-label=\"Toggle light or dark theme\"]"] },
          { id: "help", title: "Help is always one click away", body: "On every major page, Help explains that page and can start a tour of it. Each section has its own.", how: "Click Help, or press ? outside a text box.", target: ["[data-help=\"help-button\"]"] },
        ],
      },
      topics: [
        { id: "where-to-start", kind: "tutorial", title: "Where should I start?", body: "Complete beginners: Daily Learning Day 1. Know some SQL: open SQL practice and filter by Easy. Preparing for interviews: try a timed set from Interview sets or the Mock interview.", steps: ["Open Daily Learning and read the programme dashboard.", "Do today's lesson: theory, then examples, then practice.", "Mark the lesson complete when the checks pass.", "Use Practice for extra repetition on the same topic."] },
        { id: "progress-tracking", kind: "concept", title: "How progress is tracked", body: "Solved questions, attempts, daily activity and study time are saved in your browser's local storage automatically. If you sign in, they are also kept with your account.", keywords: ["streak", "saved", "local storage", "sync", "lost progress"] },
        { id: "keyboard", kind: "concept", title: "Keyboard shortcuts", body: "Ctrl/Cmd + K or / opens Search. ? opens Help. Ctrl/Cmd + Enter runs code in an editor. Esc closes dialogs, search and help.", keywords: ["shortcut", "hotkey", "ctrl", "cmd"] },
        { id: "theme", kind: "concept", title: "Switch between dark and light theme", body: "Use the sun or moon button in the top bar. The choice is saved on this device.", keywords: ["dark mode", "light mode", "appearance"] },
        { id: "restart-onboarding", kind: "workflow", title: "Replay the welcome tour", body: "Open Settings and choose Replay welcome tour, or open Help and use the link in Help Center.", steps: ["Open Settings.", "Find the Help and tours panel.", "Choose Replay welcome tour."], keywords: ["onboarding", "restart", "reset tour"] },
      ],
    },
  ],
  glossary: [],
};

export default mod;
export const { sections, glossary } = mod;
