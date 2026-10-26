# Sources and third-party software

## Included software

- **MiniSearch 7.2.0** — Copyright 2022 Luca Ongaro, MIT.
  Upstream: https://github.com/lucaong/minisearch
  The unmodified ESM distribution from the published `minisearch@7.2.0` package is included as `vendor/minisearch.js`. The complete license is included as `vendor/minisearch.LICENSE.txt`. It performs local full-text ranking of this plugin's memory items. No remote memory server or telemetry is introduced.

## Separately installed original plugin

- **dsh-bili-humanism 1.7.1** — MIT, InariNGT-Ofiicial and contributors.
  https://github.com/InariNGT-Ofiicial/dsh-bili-humanism/releases/tag/v1.7.1
  The official release tarball was verified against its matching SHA256SUMS.txt:
  `8f56d98679cd4895760dcb6b7a8631b2f2b0342e097e4920caecaf6579eba1e0`.
  It is installed as its own Desktop profile dependency, with its original LICENSE, reader, budget enforcement, SQLite ledger, media adapter, journal and personality implementation unmodified. This bridge calls the exported `Service` in `lib/service.mjs` through a version-pinned adapter; future upstream upgrades must be rechecked. QQ source/journal data directories are isolated by account, conversation and character. No third-party account credentials are automatically imported. Independent daily prefetch and platform-write features are disabled in this integration.
- **PyAV 16.1.0 (BSD-3-Clause) / Pillow 12.3.0 (MIT-CMU)** are separately installed official binary wheels in a separate local Python environment for the original plugin's frame extractor. Their wheel metadata and license files remain with that environment. These binary dependencies are not embedded in the bridge package.

## Separately installed local media tool

- **imageio-ffmpeg 0.6.0** — BSD-2-Clause Python distribution.
  Upstream: https://github.com/imageio/imageio-ffmpeg
  Installed from its official PyPI wheel under a separate local Python environment; it supplies a separately executed FFmpeg program. The wheel's own metadata and licenses remain with the installed distribution.
- The supplied Windows **FFmpeg 7.1** executable reports GPL version 3 or later (`ffmpeg -L`). FFmpeg: https://ffmpeg.org/legal.html
  This plugin invokes it as a separate local executable. The executable is not embedded in the JavaScript package or the code backup. `tools/media-runtime.json` records its local location; another installation should provide its own media runtime path. Frame sampling does not use a third-party media parsing proxy.

## Design research; no source code copied

- **dsh-speak-up 0.2.3** — same-agent native `followup`, explicit self-initiated message provenance, and allowing silence.
  Reviewed `lib/host.js` and README at `c08df2bdf22d065326c48f82f4f572fb8de64251` (MIT).
  https://github.com/Yuuyuko-uu/dsh-speak-up/tree/c08df2bdf22d065326c48f82f4f572fb8de64251
  The bridge independently implements that public message protocol and uses the `speak-up` source convention so compatible mood observers can distinguish self-initiated speech. It does not install a second scheduler or copy the upstream host/UI implementation.
- **dsh-feiyu-mood 0.5.0** — scoped system context, confidence thresholds, bounded emotional carryover and event-only injection instead of repeating one state every round.
  https://github.com/Yuuyuko-uu/dsh-feiyu-mood/tree/7eb89c1bf971bd2255a9e79972328dee59d51f5c
  Reviewed source and documentation (MIT). The bridge independently implements seven bounded emotion dimensions, direct-quote confidence checks, decay and event-only hints. It reuses an existing post-reply analysis call instead of installing another global observer. Upstream partner identity, compulsory emotional reactions and prompts are not copied.
- **dsh-bili-humanism 1.7.1** — explicit evidence coverage, revisable understanding, and separating learning records from authority.
  https://github.com/InariNGT-Ofiicial/dsh-bili-humanism/tree/22cbb1d8d44a95d325bf4fcf916792b773cf1e17
  The original plugin is installed separately as described above. This bridge uses actual subtitle, frame, journal and personality APIs; it does not fork upstream code or add ASR model weights. The compatibility adapter and per-contact conversational policy are original code.
- **dsh-agent-soul 0.1.0** — one authoritative memory source, raw evidence pointers and separate identity/capability layers.
  https://github.com/cyanwell/dsh-agent-soul/tree/349b60abfb1e950e1a0ee44176f688e4c7a50572
  Reviewed root tools, ECHO documentation and SELF/VITAL templates (MIT). No identity, scaffold, compaction takeover or behavior plugin is installed. QQ contacts retain their existing isolated local memory.

- **MaiBot** — message grouping/debounce and contextual planning.
  Examined `src/chat/debounce/README.md` and related planner context, including revision `062d45cf8bd4272ac57d7ec03fcf405e5a458211`.
  https://github.com/Mai-with-u/MaiBot/tree/062d45cf8bd4272ac57d7ec03fcf405e5a458211/src/chat/debounce
  This plugin's waiting rules and dialogue state were independently implemented in JavaScript; no GPL source from MaiBot is included.
- **Mem0** — distinct memory updates instead of continually appending summaries, and user-only factual evidence.
  Examined `mem0/configs/prompts.py`, revision `2c81af3bbe27d9bccb09c772d583df9e9be72ee5`.
  https://github.com/mem0ai/mem0/blob/2c81af3bbe27d9bccb09c772d583df9e9be72ee5/mem0/configs/prompts.py
  No Mem0 service, credentials, runtime or prompts are copied. This implementation keeps the bridge's local, per-contact evidence boundaries. It does not adopt upstream prompt instructions that misattribute private memories to public Internet sources.
- **AIRI** — explicit emotion/interaction states instead of random changes of personality.
  https://github.com/moeru-ai/airi/blob/6fe81fb6f19a88cb9b11ec262a92d4ec39d396f3/packages/stage-ui/src/constants/emotions.ts
  No AIRI assets, prompts or runtime code are copied; this plugin tracks limited user conversational context, not a claim of actual human feelings.
- **MoFox / AstrBot biliVideo** — bounded frame sampling and separate reporting of what was actually obtained.
  https://github.com/MoFox-Studio/MoFox_Bot
  https://github.com/storyAura/astrbot_plugin_biliVideo
  The latter's documented use of imageio-ffmpeg informed the local tool choice. No platform framework, video parser source or account cookies are copied. This plugin decodes directly uploaded QQ video; arbitrary protected video websites are not implemented.
