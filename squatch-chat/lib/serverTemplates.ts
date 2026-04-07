export interface ServerTemplate {
  id: string;
  name: string;
  description: string;
  emoji: string;
  channels: Array<{
    name: string;
    type: "text" | "voice";
    category?: string;
    topic?: string;
  }>;
}

export const SERVER_TEMPLATES: ServerTemplate[] = [
  {
    id: "gaming",
    name: "Gaming",
    description: "For gaming groups with dedicated game and VC channels",
    emoji: "🎮",
    channels: [
      { name: "announcements", type: "text", category: "Info", topic: "Server news and updates" },
      { name: "general", type: "text", category: "General" },
      { name: "looking-for-group", type: "text", category: "General", topic: "Find teammates" },
      { name: "General", type: "voice", category: "Voice" },
      { name: "Gaming", type: "voice", category: "Voice" },
    ],
  },
  {
    id: "study",
    name: "Study Group",
    description: "For study groups with subject channels and focus rooms",
    emoji: "📚",
    channels: [
      { name: "announcements", type: "text", category: "Info" },
      { name: "general", type: "text", category: "General" },
      { name: "resources", type: "text", category: "General", topic: "Share study materials" },
      { name: "questions", type: "text", category: "General", topic: "Ask for help" },
      { name: "Study Room", type: "voice", category: "Voice" },
      { name: "Focus Mode", type: "voice", category: "Voice" },
    ],
  },
  {
    id: "community",
    name: "Community",
    description: "For communities with events and general discussion",
    emoji: "🏕️",
    channels: [
      { name: "welcome", type: "text", category: "Info", topic: "Welcome to the server!" },
      { name: "announcements", type: "text", category: "Info" },
      { name: "general", type: "text", category: "General" },
      { name: "off-topic", type: "text", category: "General" },
      { name: "media", type: "text", category: "General", topic: "Share images and videos" },
      { name: "General", type: "voice", category: "Voice" },
    ],
  },
  {
    id: "work",
    name: "Work / Team",
    description: "For work teams with project and standup channels",
    emoji: "💼",
    channels: [
      { name: "announcements", type: "text", category: "General" },
      { name: "general", type: "text", category: "General" },
      { name: "standup", type: "text", category: "Work", topic: "Daily standups" },
      { name: "projects", type: "text", category: "Work" },
      { name: "Team Meeting", type: "voice", category: "Voice" },
    ],
  },
];
