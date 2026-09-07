# Muse Image — Technical API Guide (from `dev.meta.ai/docs/image-generation`)

**Source:** [Image generation with Muse Image](https://dev.meta.ai/docs/image-generation/) (+ [Muse Image cookbook](https://dev.meta.ai/docs/cookbook/muse-image), [Responses API guide](https://dev.meta.ai/docs/features/responses), [Responses API reference](https://dev.meta.ai/docs/api-reference/responses), [Files API](https://dev.meta.ai/docs/file-handling))
**Companion doc (concept-level):** `docs/MUSE-IMAGE-FINDINGS-2026-09-06.md` — pricing, positioning, benchmarks, product context. This doc is the technical half: endpoints, request/response shapes, parameters, and the four cookbook patterns end to end.

> Fetch note: `dev.meta.ai` / `ai.developer.meta.com` return HTTP 500 to this environment's fetcher, so the guide page itself could not be pulled verbatim. Everything below is reconstructed from (a) the guide's indexed lede, (b) the four `05_muse_image` cookbook READMEs fetched verbatim from GitHub raw, and (c) the Meta docs excerpts surfaced by search. Guide lede, verbatim per index:
> *"Generate and edit images with Muse Image through a conversation: interleave text and reference images and refine across turns on the Responses API, or make one-off calls with the OpenAI-compatible images endpoints."*
> Verify field names/limits against the live docs before shipping.

---

## 1. Two surfaces

| Surface | When to use | Shape |
|---|---|---|
| **Responses API** (conversational, recommended) | Multi-turn generate → refine → compose; anything needing server-held state, reference steering, web grounding, anchored series | `client.responses.create(model="muse-image-1.0", ...)` at `https://api.meta.ai/v1` |
| **OpenAI-compatible images endpoints** | One-off calls (single generate/edit, no conversation) | Same `base_url` + key, images-style calls |

Same base URL and auth as Muse Spark. Pricing is flat **$0.01 / image** (see concept doc).

## 2. Setup (all recipes)

```python
import base64, os
from openai import OpenAI

# The OpenAI SDK does NOT auto-read MODEL_API_KEY — pass it explicitly.
client = OpenAI(
    base_url="https://api.meta.ai/v1",
    api_key=os.environ["MODEL_API_KEY"],  # create at https://dev.meta.ai/
)
```

```bash
pip install openai          # Python 3.10+
export MODEL_API_KEY="LLM|..."
```

Helpers used throughout:

```python
def image_b64(response) -> str:
    """Base64 image off the image_generation_call item in response.output."""
    return next(
        item.result for item in response.output
        if item.type == "image_generation_call"
    )

def save_image(b64: str, path: str) -> None:
    with open(path, "wb") as f:
        f.write(base64.b64decode(b64))
    print(f"saved {path}")

def data_url(path: str) -> str:
    """Local file → base64 data URL for input_image."""
    with open(path, "rb") as f:
        return "data:image/webp;base64," + base64.b64encode(f.read()).decode()
```

## 3. Response object

Every turn returns `id` (`resp_...`), `status` (`completed`), an `output` **list** (interleaved because the model reasons before it renders), and `usage`:

```json
{
  "id": "resp_...",
  "status": "completed",
  "output": [
    { "type": "reasoning", "id": "rs_..." },
    { "type": "message", "id": "msg_...", "content": [ ... ] },
    { "type": "image_generation_call", "id": "ig_...", "status": "completed", "result": "UklGR..." }
  ],
  "usage": {
    "input_tokens": 9996,
    "input_tokens_details": { "cached_tokens": 7936 },
    "output_tokens": 908,
    "output_tokens_details": { "reasoning_tokens": 161 },
    "total_tokens": 10904
  }
}
```

- Image = base64 `result` on the **`image_generation_call`** item → `base64.b64decode` → persist bytes.
- `input_tokens` cover prompt + reference images; `output_tokens` cover reasoning + rendered image. `cached_tokens` shows conversation-cache hits on chained turns. Watch `usage` against rate limits.

## 4. The three primitives (+ anchoring)

Per the Aug 26 blog post, *"Model API exposes three primitives that most image workloads build on"*, plus the anchored-composition / multi-refinement steps the guide adds:

1. **Generate** an image from text (turn 1).
2. **Edit** an existing image (chained turn, `previous_response_id`, send only the change).
3. **Compose** several inputs into one scene (`input_image` parts, several at once).
4. **Anchor** a series on a reference set + **refine** across turns (recipes 03/04, §§8–9).

---

## 5. Generate (turn 1)

```python
turn1 = client.responses.create(
    model="muse-image-1.0",
    input=(
        "a watercolor painting of a red fox sitting in a snowy pine forest, "
        "soft golden morning light"
    ),
)
print("status:", turn1.status)
save_image(image_b64(turn1), "fox.webp")
print("usage:", turn1.usage)
```

Keep `turn1.id` — it is what later turns chain from. Non-deterministic: reruns differ.

## 6. Edit / refine (chained turns)

```python
turn2 = client.responses.create(
    model="muse-image-1.0",
    previous_response_id=turn1.id,   # server-held image carries forward
    input="add a small red wool hat on the fox's head, keep the snowy forest background",
)
save_image(image_b64(turn2), "fox_hat.webp")
```

Rules:
- Send **only the new instruction**; do not resend the image.
- **Name what changes AND what stays** (`keep ... unchanged`) — untouched parts stay stable.
- Chained turns grow `input_tokens` (server re-sends context) while your request body stays one short string — that's what buys consistency; also why long chains cost more per turn (see §8 tip: keep series to the anchors/beats actually needed).

## 7. Steer / compose with reference images

References ride as `input_image` parts inside a `{"role": "user", "content": [...]}` message. Each `image_url` = public URL, base64 data URL, or (per Next-steps) a Files-API id. Up to **50 images per request** (more → HTTP 400). Attach **only images the server doesn't already have** — reuse prior renders via `previous_response_id`.

```python
compose = client.responses.create(
    model="muse-image-1.0",
    previous_response_id=turn1.id,   # fox already on server; attach only mug + vase
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
```

⚠️ **Gotcha (HTTP 400):** content parts **must** be wrapped in a `{"role": "user", ...}` message — a bare list of content parts is rejected.

First-turn upload (starting from your own photo rather than a generated one) is the same shape — recipe 04's resale-listing turn 1:

```python
turn1 = client.responses.create(
    model="muse-image-1.0",
    input=[{
        "role": "user",
        "content": [
            {"type": "input_text", "text": (
                "add a small handwritten price tag next to each item, like "
                "a piece of masking tape with a marker price: $25 on the "
                "brass lamp, $80 on the acoustic guitar, and $15 on the "
                "stack of books; keep the items and the floor otherwise unchanged"
            )},
            {"type": "input_image", "image_url": data_url("items.webp")},
        ],
    }],
)
```

## 8. Output sizing (`tools`)

Pass `size` on the **`image_generation` tool** to shape a render — `1024x1024`, `1024x1536`, `1536x1024` in the recipes (wide establishing shots, tall action, square two-shots). Recipe 03's panel helper:

```python
def panel(prompt, size, prev, out):
    response = client.responses.create(
        model="muse-image-1.0",
        previous_response_id=prev,
        input=f"{prompt}, {STYLE}, no speech bubbles, no text, single comic panel",
        tools=[{"type": "image_generation", "size": size}],
    )
    save_image(image_b64(response), out)
    return response
```

Same mechanism composes a portrait page (`size: 1024x1536`) from panels already in the conversation — layout turn first, lettering turn second (short uppercase bubble text renders most legibly; point tails at named speakers; keep bubbles in empty space).

## 9. Advanced pattern A — web-grounded generation (recipe 02)

Ask the model to **search the live web mid-generation**, then render from what it found. Pattern: research-and-render turn → compose turn → refine-with-another-search turn, all one conversation.

```python
# Turn 1: research + render (be specific, or pin SKU/URL to fix the product)
set_turn = client.responses.create(
    model="muse-image-1.0",
    input=(
        "Search the web for a coordinated modern rattan outdoor lounge set with "
        "white cushions sold as one collection: a full sofa, a two-seat "
        "loveseat, and two matching single armchairs. Render a clean e-commerce "
        "product grid with one cell per piece ... each piece by itself and not "
        "combined into a room scene. Each rendered piece should be a faithful "
        "reproduction of the real product you find in the search ..."
    ),
)

# Turn 2: compose onto real photo (only the NEW image is attached)
compose_turn = client.responses.create(
    model="muse-image-1.0",
    previous_response_id=set_turn.id,
    input=[{"role": "user", "content": [
        {"type": "input_text", "text": (
            "Place the items from the product grid onto this backyard deck as one "
            "lounge grouping. Keep the backyard exactly as in the photo: do not "
            "change or extend the deck, fence, potted plants, or house. Only add "
            "the furniture, matching the existing daylight and shadows."
        )},
        {"type": "input_image", "image_url": data_url("backyard.webp")},
    ]}],
)

# Turn 3: refine with another search (nothing re-attached)
refine_turn = client.responses.create(
    model="muse-image-1.0",
    previous_response_id=compose_turn.id,
    input=(
        "Search the web for a matching outdoor coffee table for this set, then "
        "add it in the open centre between the pieces. Keep everything else "
        "unchanged ..."
    ),
)
```

Tips: render pieces as isolated catalog cells (faithful, no reinterpretation at compose time); name each attached image in the prompt ("this backyard deck"); repeat the leave-untouched guard every turn.

## 10. Advanced pattern B — anchored series consistency (recipe 03)

Text-to-image is stateless per call ("green caped hero" drifts every render). Fix: **generate each recurring subject once as its own turn** (character sheets on plain backgrounds; clean character-free location plates), chain everything from those anchors with `previous_response_id`, and **refer to subjects by name** — no re-upload, no re-description. Repeat the style tokens in every prompt.

```python
STYLE = "bold clean comic-book line art with thick black outlines, flat vivid colors"

hero = client.responses.create(model="muse-image-1.0",
    input=f"an original comic-book superhero character sheet, ... green eye mask ... plain white background, full body centered, {STYLE}")
cat  = client.responses.create(model="muse-image-1.0",
    previous_response_id=hero.id,
    input=f"an original comic-book cat character sheet, ... plain white background, centered, {STYLE}")
# ... bg_city chains from cat, bg_park chains from bg_city, panels chain onward
```

Generalizes to: product + scenes, avatar + poses, brand kit + templates. Cost note: every chained turn re-sends accumulated context — keep the chain to the anchors/beats actually needed.

## 11. Advanced pattern C — reasoning edit of real photos (recipe 04)

The model reads the frame, decomposes the instruction, decides what changes vs. stays. Describe edits in words; bind labels to subjects by name (`$25 on the brass lamp`); treat drawn text (prices, strikethroughs) as **drawn labels, not a pricing feature** — re-run the turn when glyphs are unclear; for real-item photos, prompt it to preserve true condition and **verify output before publishing** (it may clean up visible wear).

```python
turn2 = client.responses.create(
    model="muse-image-1.0",
    previous_response_id=turn1.id,
    input=(
        "the acoustic guitar has been sold: remove the guitar and its $80 tag "
        "entirely, leaving that spot as empty bare floor. the books have been "
        "marked down: change their tag to show the old price $15 with a line "
        "struck through it and the new price $8 next to it. keep the lamp and "
        "its $25 tag unchanged"
    ),
)
```

## 12. Stateless mode (`store=False`)

`store` defaults to `true` (server keeps each turn; chain with `previous_response_id`). To hold no server state, set `store=False` and replay the prior `image_generation_call` item as input:

```python
turn1 = client.responses.create(model="muse-image-1.0",
    input="a watercolor painting of a red fox sitting in a snowy pine forest",
    store=False)
prior_image = next(item for item in turn1.output if item.type == "image_generation_call")

turn2 = client.responses.create(model="muse-image-1.0",
    input=[prior_image,  # or prior_image.model_dump() per recipe 04
           {"role": "user", "content": [
               {"type": "input_text", "text": "add a small red wool hat on the fox's head"}]}],
    store=False)
```

## 13. Errors & gotchas

| Symptom | Cause / fix |
|---|---|
| HTTP 400 on compose/upload | Bare content-part list — wrap in `{"role": "user", "content": [...]}` |
| HTTP 400 `request contains <n> images, exceeding the maximum of 50` | >50 images in one request — split turns |
| Edit drifts / restyles untouched areas | Missing keep-guard — name what changes **and** what stays, every turn |
| Wrong label on wrong object | Ambiguous binding — bind by name (`$25 on the brass lamp`) |
| Garbled price/bubble text | Text is drawn, not typeset — shorten (uppercase for bubbles), re-run turn, verify |
| Later series turns drift off-model | Chain grew stale / anchors unnamed — chain from anchor ids, name subjects, repeat style tokens |
| Token usage climbs on refine turns | Expected — server re-sends conversation context; shorten chains, use Files API ids for repeats |

## 14. Production checklist

- Key from env (`MODEL_API_KEY`), never hard-coded; one shared `OpenAI(base_url="https://api.meta.ai/v1", ...)` client.
- Extract via `image_generation_call.result` → `base64.b64decode` → persist bytes; log `response.id` for chaining.
- Chain with `previous_response_id`; attach only genuinely new images; name each attachment in the prompt.
- Repeat style/subject tokens every turn; keep bubble/label text short.
- Upload large reused inputs once via **Files API** (reference by id instead of resending base64).
- Watch `usage` (input/output/total, cached + reasoning splits) against rate limits.
- Verify text-bearing and real-item outputs before publishing.

## 15. Links

- Guide: https://dev.meta.ai/docs/image-generation
- Cookbook hub: https://dev.meta.ai/docs/cookbook/muse-image
- Recipes (verbatim sources for §§5–11): [01 fundamentals](https://github.com/meta-models/meta-model-cookbook/tree/main/05_muse_image/01_image_api_fundamentals) · [02 web grounding](https://github.com/meta-models/meta-model-cookbook/tree/main/05_muse_image/02_backyard_restyle) · [03 anchored series](https://github.com/meta-models/meta-model-cookbook/tree/main/05_muse_image/03_anchored_generation) · [04 reasoning edit](https://github.com/meta-models/meta-model-cookbook/tree/main/05_muse_image/04_image_editing_with_reasoning)
- Responses API guide: https://dev.meta.ai/docs/features/responses · Reference: https://dev.meta.ai/docs/api-reference/responses · Files API: https://dev.meta.ai/docs/file-handling
