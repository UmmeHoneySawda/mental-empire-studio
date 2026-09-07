# Muse Image on Meta Model API — Findings & Understanding

**Source article:** [Muse Image: generate, edit, and compose images on Meta Model API](https://developer.meta.com/ai/resources/blog/build-with-muse-Image/)
- Published: 2026-08-26 (per search index)
- Companion model page: https://developer.meta.com/ai/models/muse-image/
- Cookbook (used to fill API details): `meta-models/meta-model-cookbook → 05_muse_image/01_image_api_fundamentals`
- Research backstory: [Introducing Muse Image and Muse Video (MSL, 2026-07-07)](https://ai.meta.com/blog/introducing-muse-image-muse-video-msl/)

> Note: direct fetch of `developer.meta.com` / `ai.meta.com` / `dev.meta.ai` returned HTTP 400/500 from this environment (likely bot protection), so this doc is **not a verbatim copy**. It synthesizes the article's indexed excerpts + the official cookbook README + Meta docs excerpts + third-party price/quality analysis. Verify pricing/limits in Meta docs before committing production volume.

---

## 1. TL;DR

- **Muse Image is now callable by developers on the Meta Model API**, priced for production at **$0.01 / image**.
- Before this, it powered creative experiences inside Meta AI (since July) — this is the first direct API access.
- It is a **reasoning image model**: it "thinks and plans before generating and editing", so multi-part prompts hold together.
- One model does three jobs: **generate (text→image), edit (refine across turns), compose (fuse multiple reference images)** — no multi-step pipeline to stitch together.
- You drive it via the **conversational Responses API** (`https://api.meta.ai/v1`, OpenAI-SDK compatible), model id **`muse-image-1.0`**.
- Positioning: **Pareto frontier on price-vs-quality** (~1,280 Arena Elo at $0.01, snapshot 2026-08-25). Nothing cheaper scores higher; nothing higher-scoring is cheaper — per Meta's chart.
- Known gaps (community feedback): **aggressive violence/fighting filter, no image-to-text/captioning, sub-2K output resolution**.

---

## 2. What Muse Image is

- First media-generation model from **Meta Superintelligence Labs (MSL)** (Muse Video was previewed alongside on July 7).
- Described as **"an image model that reasons before it renders"** and **"agentic image generation"**.
- Consumer availability (July launch): Meta AI app, meta.ai, Instagram Stories (US), WhatsApp (limited countries), Facebook coming soon.
- Developer availability (Aug 26 article): **Meta Model API** + also listed on **OpenRouter** (`meta/muse-image`, 65,536 token context window).
- Family relationship: **separate family from Muse Spark** — Muse Image **outputs images**, Muse Spark outputs text/code. The two are designed to **plan jointly** (Spark plans, Image renders, Spark acts).

---

## 3. Why Meta says it matters (the 3 claims)

1. **"It's agentic / reasons before it renders"**
   - Plans layout/composition before drawing.
   - Can invoke **search** (ground in factual / real-time info + visual references) and **coding tools** (write + execute code to get precise elements right — plots, charts, QR codes — then condition on the rendered figure).
   - **Self-refinement emerged during RL**: local edit when a small detail is off, regenerate from scratch when largely wrong, or switch tactics (e.g. tool use). Not hand-coded; rewarded because it produced better images.
   - Integrates with **Muse Spark** to combine code + media (animated GIFs, websites with embedded images, interactive visual games).

2. **"Quality holds across edits"**
   - Text-to-image, single-image editing, multi-image editing live in **one checkpoint**.
   - Maintains coherence across editing turns → iterative refinement / brainstorming toward a target.
   - Supports interleaved text+image prompts (e.g. "image of [A] riding [B] wearing [C] passing [D], in style of [E]").

3. **"The economics work at scale"**
   - **$0.01/image** flat. Meta's pitch: workloads "often prohibitive at frontier pricing" become routine.
   - Market context (third-party aggregators, Aug 2026): overall image-API range ~$0.005–$0.167. $0.01 sits at the floor, level with Z-Image Turbo / GPT Image 1 Mini tier, ~1/20th of Nano Banana Pro ($0.20). Some aggregators define "production-ready" floor at ~$0.032 (Seedream v5 Lite @ 2048px) — so Meta is claiming production-grade at ~1/3 of that definition. Test on your own prompts.

---

## 4. How the API works (from official cookbook)

### 4.1 Endpoint & client

- Base URL: `https://api.meta.ai/v1`
- Auth: `MODEL_API_KEY` (create in Model API dashboard at `dev.meta.ai`). OpenAI SDK does **not** auto-read it — pass explicitly.
- Model: `muse-image-1.0`
- Time to complete cookbook: ~15 min. Prereqs: Python 3.10+, `openai` package.

```python
import base64, os
from openai import OpenAI

client = OpenAI(
    base_url="https://api.meta.ai/v1",
    api_key=os.environ["MODEL_API_KEY"],
)

def save_image(response, path: str) -> None:
    """Find the image in a Responses output list and write it to disk."""
    b64 = next(
        item.result
        for item in response.output
        if item.type == "image_generation_call"
    )
    with open(path, "wb") as f:
        f.write(base64.b64decode(b64))
    print(f"saved {path}")
```

### 4.2 Turn 1 — Generate

Each `client.responses.create(...)` call = one turn. First turn: text `input` in, image bytes out.

```python
turn1 = client.responses.create(
    model="muse-image-1.0",
    input=(
        "a watercolor painting of a red fox sitting in a snowy pine forest, "
        "soft golden morning light"
    ),
)
print("status:", turn1.status)  # completed
save_image(turn1, "fox.webp")
print("usage:", turn1.usage)
```

- Keep `turn1.id` — later turns chain from it.
- Response shape: `output` is a **list** interleaving `reasoning` + `message` + `image_generation_call`. Image = base64 `result` on the `image_generation_call`.
- `usage` reports per-turn tokens (input covers prompt + reference images; output covers reasoning + image). Example from cookbook:
  `input_tokens 9996 (cached 7936), output_tokens 908 (reasoning 161), total 10904`.

### 4.3 Turn N — Refine (edit without resending image)

Pass `previous_response_id`; send **only the change**. Server holds conversation state so prior render carries forward.

```python
turn2 = client.responses.create(
    model="muse-image-1.0",
    previous_response_id=turn1.id,
    input="add a small red wool hat on the fox's head, keep the snowy forest background",
)
save_image(turn2, "fox_hat.webp")
```

### 4.4 Steer / compose with reference images

Attach `input_image` parts inside a `{"role": "user", "content": [...]}` message. One reference = steer; several = fuse into one scene. Only attach images the server doesn't already have — reuse prior renders via `previous_response_id`.

```python
def data_url(path: str) -> str:
    import base64
    with open(path, "rb") as f:
        return "data:image/webp;base64," + base64.b64encode(f.read()).decode()

compose = client.responses.create(
    model="muse-image-1.0",
    previous_response_id=turn1.id,  # fox already on server; only attach mug + vase
    input=[{
        "role": "user",
        "content": [
            {"type": "input_text", "text": (
                "combine into one watercolor scene: place the fox from the "
                "previous image on a wooden table beside this ceramic mug, "
                "with this vase of wildflowers next to the mug"
            )},
            {"type": "input_image", "image_url": data_url("mug.webp")},
            {"type": "input_image", "image_url": data_url("vase.webp")},
        ],
    }],
)
save_image(compose, "fox_mug_vase.webp")
```

> Gotcha: content parts **must** be wrapped in a `{"role": "user", ...}` message — a bare list is rejected with HTTP 400.

### 4.5 Stateless mode

`store` defaults to `true` (server keeps each turn). For no server-side state, set `store=False` and replay the prior `image_generation_call` item as input instead of `previous_response_id`.

### 4.6 Cheat sheet

| Task | Call |
|---|---|
| Generate | `client.responses.create(model="muse-image-1.0", input="...")` |
| Read image | decode `result` of `image_generation_call` in `response.output` |
| Refine | `..., previous_response_id=turn1.id, input="the change"` |
| Steer/compose | `input=[{"role":"user","content":[input_text, input_image, ...]}]` |
| No server state | `store=False` + replay prior `image_generation_call` |
| Cost tracking | `response.usage` (input / output / total) |

Production checklist (from cookbook): key from env (never hard-code); decode + persist `result` bytes; chain via `previous_response_id`; wrap references in user message; watch `usage` against rate limits. Next steps in docs: Image generation guide, Responses API reference, Files API (upload once, reference by ID instead of resending base64).

---

## 5. Benchmarks & market position

- July claim: **No. 2 on Arena** for text-to-image, single-image editing, and multi-image editing (human-preference Elo at time of writing).
- Aug 28 announcement chart ("Text-to-Image Elo vs. Cost", arena.ai Elo + Artificial Analysis/vendor pricing, snapshot 2026-08-25): **Muse Image ~1,280 Elo @ $0.01** — on the Pareto frontier with Z-Image Turbo (~$0.005 / ~1,085, cheapest) and GPT Image 2 medium (~$0.055 / ~1,383, top scorer).
- Internal Meta benchmarks (per DataCamp summary): trails GPT Image 2 on overall quality, beats Nano Banana 2 on single + multi-image editing.
- Caveat: Arena Elo = **blind human preference**, not task accuracy (text rendering, instruction adherence, brand safety, style consistency). Run your own suite for those.

---

## 6. Trust, safety & product integration

- **Content Seal**: images from Meta AI app / meta.ai carry a hidden provenance signal surviving crop/compress/resize/screenshot; preview detector at `meta.ai/identification`. Video extension planned.
- Consumer-only (not necessarily API): Instagram `@`-mention / preset features letting generations draw on public Instagram photos for social context — the part drawing privacy scrutiny; public-account opt-out exists but is buried (per DataCamp). Sketch/markup edit affordance in Meta AI app.
- API-side filtering (community reports): **violence/fighting/injury filter is aggressive** — hard stop for game/sports/comics/news-illustration use cases; NSFW guardrails described as more predictable.

---

## 7. Limitations to design around

1. **Aggressive content filter** on violence — test your category early.
2. **No image-to-text** — generates/edits only; pair with a separate vision model for describe-then-generate loops.
3. **Sub-2K output** — fine for thumbnails/social variants; hero/print needs downstream upscale.
4. **Flat per-image pricing hides reasoning cost** — planning/search/code-execution is either selective, small-budget, or Meta-absorbed. Watch for future surcharges/tiers/rate limits on the "agentic" path.
5. **No multi-turn scene-state guarantee** — early testers note drift across many sequential edits; no layer-level control like a design tool.
6. **Non-deterministic** — cookbook images are from an actual run; yours will differ.

---

## 8. Relevance to Mental Empire Studio (faceless-YouTube automation)

- **Thumbnail variants at volume**: $0.01/image makes A/B thumbnail batches (style/pose/text-layout sweeps) cheap; compose path can fuse subject + style refs into one render.
- **Refine-across-turns fits thumbnail iteration**: generate base → "make text area emptier on left" / "more contrast" without resending assets (saves tokens vs re-upload).
- **Watch-outs before adopting**: sub-2K cap (upscale step for hero thumbs), violence filter (true-crime / sports / combat commentary niches may get blocked), no captioning (still need a vision model for thumbnail audit loops), and local-first constraint in AGENTS.md (cloud API key = exception to justify; Groq transcription key is the only current precedent).
- **Stack fit**: pairs naturally with a reasoning LLM planner (Muse Spark pattern: plan → render → verify → revise) and a Files-API-by-ID upload cache to avoid resending base64 refs every turn.

---

## 9. Links

- Article: https://developer.meta.com/ai/resources/blog/build-with-muse-Image/
- Model page: https://developer.meta.com/ai/models/muse-image/
- API overview: https://dev.meta.ai/docs/overview
- Image generation guide: https://dev.meta.ai/docs/image-generation
- Responses API reference: https://dev.meta.ai/docs/api-reference/responses
- Files API: https://dev.meta.ai/docs/file-handling
- Cookbook fundamentals: https://github.com/meta-models/meta-model-cookbook/tree/main/05_muse_image/01_image_api_fundamentals
- Research post: https://ai.meta.com/blog/introducing-muse-image-muse-video-msl/
- OpenRouter: https://openrouter.ai/meta/muse-image
