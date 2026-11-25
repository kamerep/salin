"""Default language configuration, seeded into the `languages` table on first
start. After that the table is the source of truth: languages, their prompt
notes and reply registers are edited in Settings, not in code."""

from __future__ import annotations

from typing import Any


def _r(id_: str, label: str, instruction: str, hint: str = "") -> dict[str, str]:
    return {"id": id_, "label": label, "hint": hint, "instruction": instruction}


DEFAULT_LANGUAGES: list[dict[str, Any]] = [
    {
        "code": "en", "name": "English", "native_name": "English", "quality": "strong", "sort": 10,
        "speech_code": "en", "tts_code": "en-GB",
        "notes": "Plain business English a manager reads quickly. Keep the sender's intent, "
                 "politeness and urgency. Avoid idioms that do not travel.",
        "registers": [
            _r("formal", "Formal", "Polite, complete sentences for a client, senior or official."),
            _r("neutral", "Neutral", "Plain, friendly business English for colleagues."),
            _r("casual", "Casual", "Short and relaxed, as in a chat with a peer."),
        ],
    },
    {
        "code": "tl", "name": "Tagalog", "native_name": "Tagalog / Filipino", "quality": "strong",
        "sort": 20, "speech_code": "tl", "tts_code": "fil-PH",
        "notes": (
            "Messages mix English and Tagalog inside one sentence (Taglish): this is normal, "
            "never correct it. Expect texting shorthand: po/opo (politeness), daw/raw (reportedly; "
            "someone else said it: keep that in English as 'X says' or 'apparently'), lang, na, pa, "
            "naman, kasi/kc, sana/sna, yung/ung, pwede/pde, nlng (na lang), di (hindi), tnx, pls, "
            "notif, sked, OTW, EOD, ASAP, 'noted po', 'copy po', 'sige po'. Prefix pa- or paki- on a "
            "verb is a polite request (pa-send = please send). Time words: kanina = earlier today; "
            "mamaya = later today; bukas = tomorrow; kahapon = yesterday. Keep them as words, do not "
            "invent dates. Respect markers (po, opo, ho, kayo/ninyo for one person) show the "
            "relationship to the reader: report them in formality. When writing Tagalog, keep the "
            "English business words people use (invoice, deadline, meeting, email)."
        ),
        "registers": [
            _r("formal", "Formal", "Respectful Tagalog with po/opo and full words, no slang; for a "
               "senior colleague, client or official.", hint="po, opo"),
            _r("casual", "Casual", "Friendly everyday Tagalog for peers; no po unless the draft asks for it."),
            _r("taglish", "Office Taglish", "Natural office Taglish: Tagalog sentence frame with the "
               "English business words people really use; po where the writer would use it."),
        ],
    },
    {
        "code": "ceb", "name": "Cebuano", "native_name": "Cebuano / Bisaya", "quality": "weak",
        "sort": 30, "speech_code": "tl", "tts_code": "",
        "notes": (
            "Visayan language of Cebu, much of the Visayas and Mindanao; often mixed with Tagalog and "
            "English. Do not read Cebuano words with their Tagalog meaning: false friends exist "
            "(libog = confused in Cebuano). Politeness: palihug (please), salamat (thanks), kamo/ninyo "
            "for respect. Model quality is lower than for Tagalog: mark uncertain phrases as "
            "ambiguities and set needs_native_review."
        ),
        "registers": [
            _r("formal", "Formal", "Respectful Cebuano with palihug and polite address; no slang."),
            _r("casual", "Casual", "Friendly everyday Bisaya as spoken between peers."),
        ],
    },
    {
        "code": "ilo", "name": "Ilocano", "native_name": "Ilokano", "quality": "weak",
        "sort": 40, "speech_code": "tl", "tts_code": "",
        "notes": (
            "Language of Northern Luzon; often mixed with Tagalog and English. Politeness markers "
            "include apo and addressing elders as manong/manang; agyamanak = thank you. Model quality "
            "is lower than for Tagalog: mark uncertain phrases as ambiguities and set "
            "needs_native_review."
        ),
        "registers": [
            _r("formal", "Formal", "Respectful Ilocano using apo and polite address; no slang."),
            _r("casual", "Casual", "Friendly everyday Ilocano between peers."),
        ],
    },
    {
        "code": "sw", "name": "Swahili", "native_name": "Kiswahili", "quality": "strong",
        "sort": 50, "speech_code": "sw", "tts_code": "sw-KE",
        "notes": (
            "Workplace Swahili in Kenya often mixes in English, and informal messages may use Sheng "
            "(Nairobi slang). Do not correct the mix. Politeness: tafadhali (please), asante (thanks); "
            "greetings carry respect (shikamoo to elders). Note Kenyan versus Tanzanian usage when it "
            "changes the meaning."
        ),
        "registers": [
            _r("formal", "Formal", "Respectful standard Swahili for a client, senior or official."),
            _r("casual", "Casual", "Friendly everyday Swahili for colleagues."),
            _r("mixed", "Office mix", "Natural Kenyan office Swahili with the English business words "
               "people use."),
        ],
    },
    {
        "code": "es", "name": "Spanish", "native_name": "Español", "quality": "strong",
        "sort": 60, "speech_code": "es", "tts_code": "es-ES",
        "notes": "Neutral international Spanish unless the message shows a regional variety.",
        "registers": [
            _r("formal", "Formal", "Use usted and polite business phrasing.", hint="usted"),
            _r("casual", "Casual", "Use tú; friendly and direct.", hint="tú"),
        ],
    },
    {
        "code": "fr", "name": "French", "native_name": "Français", "quality": "strong",
        "sort": 70, "speech_code": "fr", "tts_code": "fr-FR",
        "notes": "Standard French business usage.",
        "registers": [
            _r("formal", "Formal", "Use vous and standard business courtesy.", hint="vous"),
            _r("casual", "Casual", "Use tu; friendly and direct.", hint="tu"),
        ],
    },
    {
        "code": "de", "name": "German", "native_name": "Deutsch", "quality": "strong",
        "sort": 80, "speech_code": "de", "tts_code": "de-DE",
        "notes": "Standard German business usage.",
        "registers": [
            _r("formal", "Formal", "Use Sie and standard business courtesy.", hint="Sie"),
            _r("casual", "Casual", "Use du; friendly and direct.", hint="du"),
        ],
    },
]
