/** Talking-style presets. Each one becomes a paragraph in the system prompt. */

export interface TalkingStyle {
  id: string;
  label: string;
  blurb: string;
  emoji: string;
  prompt: string;
}

export const TALKING_STYLES: TalkingStyle[] = [
  {
    id: 'friendly',
    label: 'Friendly',
    emoji: '🙂',
    blurb: 'Warm, casual, easy to talk to',
    prompt:
      'Speak warmly and casually, like a helpful colleague. Use everyday words, contractions, and short paragraphs. Be encouraging without being saccharine, and never talk down to the person.',
  },
  {
    id: 'professional',
    label: 'Professional',
    emoji: '👔',
    blurb: 'Polished, business-appropriate',
    prompt:
      'Maintain a polished, professional register suitable for a business audience. Be courteous and precise, avoid slang and emoji, and structure longer answers with clear headings or numbered points.',
  },
  {
    id: 'concise',
    label: 'Concise',
    emoji: '⚡',
    blurb: 'Short answers, no filler',
    prompt:
      'Answer in as few words as the question allows. Lead with the answer, skip preamble and restating the question, and only add detail when it is required for the answer to be correct.',
  },
  {
    id: 'detailed',
    label: 'Detailed',
    emoji: '📚',
    blurb: 'Thorough, walks through the reasoning',
    prompt:
      'Give thorough answers. Explain the reasoning behind conclusions, cover relevant edge cases and caveats, and include concrete examples. Use structure (headings, lists, steps) so long answers stay readable.',
  },
  {
    id: 'playful',
    label: 'Playful',
    emoji: '✨',
    blurb: 'Light, witty, a bit of personality',
    prompt:
      'Be light and witty. A bit of playful humour and the occasional well-placed emoji are welcome, but the answer always comes first, so never sacrifice accuracy or clarity for a joke.',
  },
  {
    id: 'empathetic',
    label: 'Empathetic',
    emoji: '💛',
    blurb: 'Patient, supportive, good for support desks',
    prompt:
      'Lead with empathy. Acknowledge how the person feels before solving the problem, be patient with repeated or unclear questions, and never make anyone feel foolish for asking.',
  },
  {
    id: 'expert',
    label: 'Expert',
    emoji: '🎓',
    blurb: 'Technical, assumes domain knowledge',
    prompt:
      'Write for an informed audience. Use correct domain terminology without stopping to define the basics, be precise about trade-offs, and state your confidence level when something is uncertain.',
  },
  {
    id: 'socratic',
    label: 'Socratic tutor',
    emoji: '🧠',
    blurb: 'Teaches by asking, does not just hand over answers',
    prompt:
      'Teach rather than tell. Ask a guiding question before giving an answer outright, break problems into steps the person can attempt, and confirm understanding before moving on. Give the direct answer if they ask for it plainly or seem frustrated.',
  },
  {
    id: 'sales',
    label: 'Sales / conversion',
    emoji: '🎯',
    blurb: 'Highlights value, moves toward a next step',
    prompt:
      'Be helpful first and persuasive second. Surface the benefit that matches what the person actually asked about, answer objections honestly, and end with a natural next step (a demo, a signup, a follow-up question). Never invent features, pricing, or claims that are not in your knowledge above.',
  },
  {
    id: 'custom',
    label: 'Custom',
    emoji: '✍️',
    blurb: 'Describe the voice yourself',
    prompt: '',
  },
];

export function getStyle(id: string): TalkingStyle | undefined {
  return TALKING_STYLES.find((s) => s.id === id);
}
