// Caveman-style filler removal: eliminate verbose phrases, preserve substance.
// Inspired by https://github.com/juliusbrussee/caveman

const FILLER_PATTERNS = [
  // Sentence starters
  [/\bIn order to\b/g, "To"],
  [/\bIn order for\b/g, "For"],
  [/\bIt is important to note that\b/gi, "Note:"],
  [/\bPlease note that\b/gi, "Note:"],
  [/\bIt should be noted that\b/gi, "Note:"],
  [/\bAs you can see,?\b/gi, ""],
  [/\bAs mentioned (above|previously|earlier),?\b/gi, ""],
  [/\bAs previously (mentioned|stated|discussed),?\b/gi, ""],
  [/\bNeedless to say,?\b/gi, ""],
  [/\bIt goes without saying( that)?\b/gi, ""],
  [/\bAt the end of the day,?\b/gi, ""],
  [/\bBasically,?\b/gi, ""],
  [/\bEssentially,?\b/gi, ""],
  [/\bFundamentally,?\b/gi, ""],
  [/\bLiterally,?\b/gi, ""],
  [/\bObviously,?\b/gi, ""],
  [/\bClearly,?\b/gi, ""],
  [/\bOf course,?\b/gi, ""],
  [/\bNaturally,?\b/gi, ""],
  [/\bCertainly,?\b/gi, ""],
  [/\bDefinitely,?\b/gi, ""],
  [/\bAbsolutely,?\b/gi, ""],

  // Padding verbs
  [/\bI would like to\b/gi, "I'll"],
  [/\bI am going to\b/gi, "I'll"],
  [/\bWe are going to\b/gi, "We'll"],
  [/\bWe would like to\b/gi, "We'll"],
  [/\bfeel free to\b/gi, ""],
  [/\bDon't hesitate to\b/gi, ""],

  // Wordy prepositions
  [/\bdue to the fact that\b/gi, "because"],
  [/\bin the event that\b/gi, "if"],
  [/\bin spite of the fact that\b/gi, "although"],
  [/\bfor the purpose of\b/gi, "for"],
  [/\bwith regard to\b/gi, "regarding"],
  [/\bwith respect to\b/gi, "on"],
  [/\bin terms of\b/gi, "in"],
  [/\bon the basis of\b/gi, "based on"],
  [/\bprior to\b/gi, "before"],
  [/\bsubsequent to\b/gi, "after"],
  [/\bin addition to\b/gi, "besides"],
  [/\bas well as\b/gi, "and"],

  // Throat-clearing closers
  [/\bHope this helps[.!]?\b/gi, ""],
  [/\bLet me know if you have any (other )?questions[.!]?\b/gi, ""],
  [/\bPlease let me know if (you need|there is) anything else[.!]?\b/gi, ""],
  [/\bFeel free to ask if you need more (details|information|help)[.!]?\b/gi, ""],
  [/\bI hope this (answers|clarifies|helps)[^.]*[.!]?\b/gi, ""],

  // LLM self-referential filler (Caveman+ patterns)
  [/\bAs an AI (language model|assistant),?\b/gi, ""],
  [/\bAs a large language model,?\b/gi, ""],
  [/\bI('m| am) Claude[,.]?\s*/gi, ""],
  [/\bIn this (response|answer|explanation),?\b/gi, ""],
  [/\bIn this context,?\b/gi, ""],
  [/\bLet me (break this down|explain|clarify|walk you through)[:.]\s*/gi, ""],
  [/\bTo (answer|address) your (question|request),?\b/gi, ""],
  [/\bGreat (question|point)[!.]?\s*/gi, ""],
  [/\bCertainly[!,]?\s*/gi, ""],
  [/\bSure[!,]?\s*/gi, ""],
  [/\bOf course[!,]?\s*/gi, ""],
  [/\bAbsolutely[!,]?\s*/gi, ""],
  [/\bI('ll| will) (now |)?(help you|assist you)[^.]*[.]\s*/gi, ""],
  [/\bI understand (that )?(you|your)[^.]*[.]\s*/gi, ""],
  [/\bThank you for (your question|reaching out|asking)[^.]*[.]\s*/gi, ""],

  // Redundant hedging
  [/\bIt's worth (noting|mentioning) that\b/gi, "Note:"],
  [/\bIt's important to (understand|note|remember) that\b/gi, ""],
  [/\bI (should|want to|need to) (point out|mention) that\b/gi, ""],
  [/\bJust to be (clear|clarify|safe),?\b/gi, ""],
  [/\bWith that (said|being said),?\b/gi, ""],
  [/\bThat (said|being said),?\b/gi, ""],
  [/\bTo summarize,?\b/gi, "Summary:"],
  [/\bTo conclude,?\b/gi, ""],
  [/\bIn summary,?\b/gi, "Summary:"],
  [/\bIn conclusion,?\b/gi, ""],
  [/\bTo put it (simply|another way|differently),?\b/gi, ""],
];

/**
 * Remove verbose filler from a string.
 * @param {string} text
 * @returns {{ text: string, savedChars: number }}
 */
export function trimFiller(text) {
  let out = text;
  for (const [pattern, replacement] of FILLER_PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  // Collapse double spaces left behind
  out = out.replace(/  +/g, " ").replace(/^ | $/gm, "");
  // Collapse blank lines left behind (max one consecutive blank)
  out = out.replace(/\n{3,}/g, "\n\n");
  return { text: out, savedChars: text.length - out.length };
}
