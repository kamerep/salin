# Salin user guide

Salin translates workplace messages written in Tagalog, English or the Taglish mix people really send, and drafts replies in Tagalog. *Salin* is Tagalog for "translation".

## Translate a message

1. Open **Translate** and paste the message.
2. Pick a **direction**. *Detect* sends Tagalog and Taglish into English and English into Tagalog.
3. Pick a **model**. *Fast* (Claude Haiku) suits everyday messages. *Careful with tone* (Claude Sonnet) is better when politeness, hierarchy or wording matters.
4. Optional: open **Add context** and say who sent it or what it is about.
5. Press **Translate** or <kbd>Ctrl</kbd> + <kbd>Enter</kbd>.

The result shows:

| Field | What it tells you |
|---|---|
| Translation | Plain business English (or Tagalog), keeping names, amounts and dates exactly as written |
| Action requested | Whether the sender wants something done, and what |
| Deadline | Any time or date mentioned. Words like *mamaya* (later today) are kept as words, not turned into dates |
| Tone and formality | For example "polite, slightly urgent" and *formal* when the sender used po/opo |
| Confidence | High, medium or low, with the reason. Low means: check with a native speaker |
| Regional language | Named when Bisaya, Ilocano or another language is mixed in. Salin flags it rather than guessing |
| Unclear phrases | Exact words that can be read two ways, with the likely meaning |
| Not in your glossary | Names or abbreviations Salin did not know, each with **Add to glossary** |

**Draft a reply** carries the original message to the Reply page.

## Draft a reply

1. Open **Reply** (or use **Draft a reply** on a translation).
2. Write what you want to say in English.
3. Pick a **register**:
   - **Formal**: respectful Tagalog with *po* and *opo*, for seniors, clients and officials.
   - **Casual**: friendly everyday Tagalog for peers.
   - **Office Taglish**: Tagalog sentences with the English business words people use (invoice, deadline, meeting).
4. Optional: extra instructions such as "keep it short".
5. Press **Draft reply**.

You get the Tagalog reply, a literal English back-translation to check the meaning, notes on word choices, and cautions. When the message is legal, regulatory, contractual or otherwise sensitive, Salin asks you to **have a native speaker check it before sending**. Do that for anything going to a client.

## Glossary

The glossary tells Salin who people are and what shorthand means, so you never explain "MR is Maria Reyes" twice. Every entry is sent with each request.

- **Kinds**: person, company or entity, abbreviation, term.
- **Add** from the form at the top, or from *Not in your glossary* on a translation.
- **Edit** and **delete** in the list. A delete can be undone from the message that appears.
- **Import CSV** with the header `term,meaning,kind,notes` (UTF-8). Existing terms are updated, new ones added; bad rows are reported and skipped.
- **Export CSV** downloads the whole glossary.

The glossary holds real names. Treat exports as confidential.

## History

Saved translations and replies, newest first.

- **Search** covers the original text and the result.
- Filter by translations, replies or starred items; star anything you want to keep.
- Select an item to see the full result. Translations can be replied to from here.
- **Clear history** deletes everything (optionally keeping starred items). Type `DELETE` to confirm.

Each request has a **Save to history** switch. Turn it off for messages you do not want stored. The default, and automatic deletion after 7 to 365 days, are in Settings.

## Settings

- **API key**: paste an Anthropic API key, then **Test key**. The key is stored write-only.
- **Models**: default model, effort per model, default reply register.
- **Privacy**: save-by-default and automatic deletion.
- **Offline fallback**: when Claude cannot be reached (no key, no internet, API outage) Salin can use a local model through Ollama. Results are marked and always low confidence.
- **Appearance**: system, light or dark theme.

## Desktop shortcuts

- The **Salin** launcher in the app grid opens Salin in its own window and starts the container if needed. Pin it to the dock.
- `salin-clip` translates the clipboard and shows the result as a notification (it also copies the translation back to the clipboard). Run the desktop installer with `--hotkey` to bind it to <kbd>Super</kbd> + <kbd>Alt</kbd> + <kbd>T</kbd>.

## Limits

- Everyday and business Tagalog is strong. Deep regional dialects are weaker: Salin marks them low confidence instead of guessing.
- Machine output is a draft. For legal or regulatory text going to a client, have a native speaker check it.
