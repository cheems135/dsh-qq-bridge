# Sources and third-party software

## Included software

- **video-watch-plus** — MIT, xinhailaopo and upstream contributors; pinned revision `8ca266f9cf9e5ffce7e9d424aa0e937a897b608d`.
  https://github.com/xinhailaopo/video-watch-plus/tree/8ca266f9cf9e5ffce7e9d424aa0e937a897b608d
  Selected video-watch probe, acoustic-analysis, hallucination-check and synthetic-fixture utilities are vendored under `vendor/video-watch-plus`, together with LICENSE, NOTICE and the upstream CFITCorporation/video-watch-skill MIT notice (Copyright 2026 CFITSec). Bridge orchestration in `tools/video_plus.py` is original integration code. Its configured local environment separately installs FFmpeg, ImageMagick, yt-dlp, faster-whisper, NumPy and the public Systran/faster-whisper-small model; binaries and model weights are not embedded in the bridge package. Tool metadata and licenses remain in their local installations. Public-link downloading does not import browser cookies.

- **DSHBox Pilot and Browser** are separately installed Android components, not embedded or copied into this package.
  https://github.com/WSK-build/DSHBox
  Original mobile adapters call their public local CLI protocols. DSHBox retains its GPL-3.0 licensing and authorization rules. ADB is used only for initial installation and is not required by the installed mobile bridge. No password or device identifier is included in this source distribution.

- **MiniSearch 7.2.0** — Copyright 2022 Luca Ongaro, MIT.
  Upstream: https://github.com/lucaong/minisearch
  The unmodified ESM distribution from the published `minisearch@7.2.0` package is included as `vendor/minisearch.js`. The complete license is included as `vendor/minisearch.LICENSE.txt`. It performs local full-text ranking of this plugin's memory items. No remote memory server or telemetry is introduced.

## Legacy compatibility

The bridge no longer imports or requires dsh-bili-humanism. Any previously installed copy belongs to the host profile and is not distributed or activated by this package. Custom reading, real browsing and learning use the bridge's own adapters.

## Separately installed local media tool

- **imageio-ffmpeg 0.6.0** — BSD-2-Clause Python distribution.
  Upstream: https://github.com/imageio/imageio-ffmpeg
  Installed from its official PyPI wheel under `E:/Codex/tools/qq-bridge-media`; it supplies a separately executed FFmpeg program. The wheel's own metadata and licenses remain with the installed distribution.
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
  Historical design research only; the active custom website reader is independent of this plugin. No upstream code or model weights are included.
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

## Public meme vocabulary (2026-10-28 snapshot)

CHIME: https://github.com/yuboxie/chime (MIT, copyright 2025 Yubo Xie), source data blob cfc4b02cab4edac6452ed2ba08e361e0cc2aa51c. Full notice: assets/meme-chime.LICENSE.txt.

China Meme Dictionary: https://github.com/WenKanghwdd/china-meme-dictionary (MIT, copyright 2025-2026 WenKanghwdd), source data blob bc8787de17f3a4fc3f2a7f4fe4c6d76d063fc4f2. Full notice: assets/meme-dictionary.LICENSE.txt.

Additional independently worded vocabulary summaries reference public factual entries at https://github.com/ThySummer14/meme-archive (data blob 3b31be4c61cf9776aab66151ca03af54c84856e3). No repository code or full archive is included. Origins and live popularity are not independently verified; use as optional contextual vocabulary.

## Browser runtime and 2026-10-29 design references

- **Playwright Core 1.62.1** — Microsoft Corporation, Apache-2.0. The installed upstream core runtime is vendored under `vendor/playwright-core` with its original LICENSE, NOTICE and ThirdPartyNotices.txt. Browser executables are not bundled. https://github.com/microsoft/playwright
- **SurfCore 0.6.20**, reviewed at `d7f6b33d57b1667508c48206cbcc455815d6d336`: image refresh/fallback, real evidence coverage and contextual learning. No upstream source code copied or package dependency added. https://github.com/Mieksido/surfcore
- **dsh-soundcheck 0.9.6**, reviewed at `52e7785e1b52457020d0060d88f0addd60054beb`: local measurement, explicit uncertainty and actual audio evidence. No upstream engine/model bundle copied or plugin dependency added. Local acoustic analysis reuses the separately credited video-watch-plus utilities. https://github.com/ALittleLov/dsh-soundcheck
- **dsh-browser-playwright**: semantic snapshots and fresh element references informed the original bridge browser controller; no upstream implementation copied. https://github.com/ChenyuHeee/dsh-browser-playwright


## Natural expression examples (1.26.0, extended 2026-11-02)
220 small conversational examples selected from the LCCC toy sample in thu-coai/CDial-GPT, revision 81064865221d3503251d633f3d0b651004c938a6 (100 in the original batch, 120 more in a filtered second batch). Project license: MIT; attribution and full license are included in assets/expression-lccc.LICENSE.txt. Samples are local retrieval references, not a full dataset import or model-weight training. Political, promotional, VPN/credential and explicit entries were filtered out. Source: https://github.com/thu-coai/CDial-GPT

MaiBot expression selection and jargon-learning modules were reviewed for design ideas at revision 2a9af62cec37035d29237acbe2cf3adceb700b27. No MaiBot source code is included; this plugin's implementation is independent. https://github.com/Mai-with-u/MaiBot (GPL-3.0). NaturalConv was reviewed but no data was included because of its separate noncommercial conditions.


## Playback timing reference (2026-11-02)

The live watch segment ramp and position-freshness rules in `watch-live.js` follow the public design of [dsh-watch-together](https://github.com/SAOS-3624/dsh-watch-together) (Apache-2.0). No source files were copied; the short-first/longer-later segment boundaries, lead-before-end delivery and paused/stale position distinction were reimplemented for this bridge. The video sampling window and cache are local changes in `tools/video_plus.py`.

## Expanded expression corpus (2026-11-02)

The local reference corpus adds 80 short dialogues written for this project (`source: project-original`, `license: original`), plus 15 short adult-humor/innuendo exchanges (rating `bawdy`, also project-original). They cover everyday emotions, common scenes, mild profanity/conflict, non-graphic adult humor and non-graphic adult intimacy; none are copied from external chat logs. They are retrieval references for tone and turn-taking, not model-weight training. Ratings: `general` in any chat; `edgy` for owner-private/free-expression contexts; `bawdy` in any chat as jokes only, without explicit description or targeting someone present; `adult` (intimate) restricted to owner-private chats with the adult mode enabled. A second LCCC batch (120 dialogues) was filtered for politics, promotions, VPN/credentials, explicit content and personal identifiers before inclusion.

KdConv (Apache-2.0, https://github.com/thu-coai/KdConv): four short conversational runs (turns without knowledge annotations) extracted from the public film/music test split are included as local references (`source: KdConv test split`, `license: Apache-2.0`). The license copy is in assets/expression-kdconv.LICENSE.txt. The full KdConv corpus is not bundled; `tools/import-expression-corpus.mjs` can import a local download, and imported entries keep their stated source, URL and license. The person importing is responsible for the rights to use them.


## Music evidence update (1.28.0)
Re-reviewed ALittleLov/dsh-soundcheck main README and engine/analyze.py on 2026-10-30: distinction between measurements/candidates, tempo ambiguity and limits of instruments/lyrics inferred from mixtures. https://github.com/ALittleLov/dsh-soundcheck (MIT). The new NumPy music-measure.py, URL acquisition and chart integration are original implementation; no upstream engine code, model weights or plugin runtime is copied. FFmpeg produces waveform/spectrum pictures, with existing runtime licensing unchanged. Existing video-watch-plus acoustic heuristics are retained for general audio but are not used to label a mixed music track as instrumental or vocal.

## Score-based experimental singing

PyWORLD 0.3.5 (MIT), NumPy 2.5.4 and SoundFile 0.14 are installed separately in a local Python environment; their code, models and binaries are not embedded in this plugin. WORLD performs spectral-envelope and pitch resynthesis of the current configured voice samples. Upstream: https://github.com/JeremyCCHsu/Python-Wrapper-for-World-Vocoder . Song scores in assets/songs.json are hand-entered traditional melodies, with no commercial vocal recording bundled.


## MemeWiki vocabulary snapshot

Original: https://github.com/in1t1a1/astrbot_plugin_memewiki (in1t1a1). Snapshot obtained from https://github.com/thawline/dsh-memewiki at 15c3c34149dfb0d5ea3a9b3a4b4f0d7f91318e91. Data: 6668 entries, compiled 2026-10-26, contents credited to cnmeme.wiki and original authors. Retained notices: assets/memewiki.NOTICE.txt and assets/memewiki.LICENSE.txt. This package adapts data for local retrieval, not a separate plugin dependency. Existing Chime vocabulary and attribution are retained.


## Bilibili adapter 1.45.0

- WBI mixin table and signing approach adapted from dsh-bili-humanism 1.7.1 (MIT), Copyright (c) 2026 InariNGT-Ofiicial. Only the signing algorithm is reused; the installed package is not required. Full notice: vendor/humanism-WBI.LICENSE.txt. https://github.com/InariNGT-Ofiicial/dsh-bili-humanism
- Workflow architecture reference: c1overzz/dsh-bili-scroll (MIT). No source or credential files from that project are bundled. https://github.com/c1overzz/dsh-bili-scroll
- Login/search/comment API behavior cross-checked with the upstream bilibili-mcp project. The adapter is original JavaScript and does not include or run the upstream Python service. https://github.com/adoresever/bilibili-mcp

## LXGW WenKai Lite / 霞鹜文楷轻便版

The private diary uses a locally bundled WOFF2 conversion of LXGWWenKaiLite-Regular.ttf (glyph outlines and font family unchanged), upstream Git blob b6a91870361ff0ddf5bb12d8327fda1948794074 from https://github.com/lxgw/LxgwWenKai-Lite. Original copyright and SIL Open Font License 1.1 terms are included verbatim in assets/fonts/OFL.txt. Font loading does not contact external font services.
