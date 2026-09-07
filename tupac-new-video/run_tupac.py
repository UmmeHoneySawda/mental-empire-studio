"""Tupac 1991 anchored-series runner — ALL images forced to 1920x1280.

One conversation: 7 anchors -> 15 clean frames, chained via previous_response_id.
STYLE repeated every turn. No text in any frame. Safety: on block, retry once
with a safer non-graphic rewrite, never skip a beat.

Usage (from repo root):
  $env:MODEL_API_KEY = [System.Environment]::GetEnvironmentVariable("META_API_KEY","User")
  python tupac-new-video\\run_tupac.py [--only-anchors | --only-frames-from RESP_ID | --frame N]
"""
import argparse
import json
import os
import sys
import time

BASE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(BASE), ".agents", "skills", "muse-image", "scripts"))
# fallback: repo-root layout D:\\Work\\mental-empire-studio\\.agents\\skills\\...
for cand in (os.path.join(BASE, "..", ".agents", "skills", "muse-image", "scripts"),
             r"D:\Work\mental-empire-studio\.agents\skills\muse-image\scripts"):
    if os.path.isdir(cand) and cand not in sys.path:
        sys.path.insert(0, cand)

from common import MODEL, get_client, image_b64, save_image  # noqa: E402

SIZE_ALL = "1920x1280"
STYLE = ("photorealistic cinematic documentary reconstruction, early-1991 photojournalistic "
         "color science, subtle 35mm film grain, natural skin texture and pores, physically based "
         "fabrics, available-light realism, restrained contrast, historically grounded, "
         "serious investigative tone, never glossy, never illustration")

ANCHORS = [
    ("tupac20",
     "character sheet of TUPAC20, historically faithful likeness of Tupac Shakur at age 20 in "
     "summer 1991, lean athletic build, warm medium-brown skin, dark brown eyes, short faded "
     "high-top / temp-fade haircut of the period, light thin mustache with faint goatee, alert "
     "intelligent expression, full body centered, plain white background, chest-up front + "
     "three-quarter + profile, same face in all views, simple unbranded dark crew-neck shirt used "
     "only for reference, no bandana, no jewelry, no text, no logo, no watermark, one person only"),
    ("afeni91",
     "character sheet of AFENI91, historically faithful likeness of Afeni Shakur in 1991, Black "
     "woman late 30s, medium-brown skin, short natural period hair, expressive resolute eyes, "
     "dignified bearing, waist-up front + three-quarter + profile, same face in all views, plain "
     "white background, understated period blouse and dark jacket used only for reference, "
     "no text, no logo, no watermark, one person only"),
    ("manna",
     "character sheet of MANNA, consistent dramatized composite of a white American male music "
     "journalist in his early 40s in 1991, average build, short brown hair with light recession, "
     "clean-shaven, thoughtful observant expression, waist-up front + three-quarter + profile, same "
     "face in all views, plain white background, muted early-1990s casual button shirt used only "
     "for reference, notepad implied but no readable text, no text, no logo, no watermark, one person only"),
    ("hicken",
     "character sheet of HICKEN, consistent dramatized composite of a white American male theater "
     "teacher in his 50s in late-1980s Baltimore, graying hair, glasses, encouraging attentive "
     "expression, average build, waist-up front + three-quarter + profile, same face in all views, "
     "plain white background, plain dark sweater used only for reference, "
     "no text, no logo, no watermark, one person only"),
    ("valley_home",
     "clean location plate of VALLEY_HOME, modest San Fernando Valley rental home living room in "
     "August 1991, no characters, no people, early-1990s sofa, wood coffee table, box fan, vertical "
     "blinds with harsh daylight, small bookshelf with paperbacks, period corded phone and boombox, "
     "lived-in but tidy, eye-level observational camera, no text, no logos"),
    ("bsa_room",
     "clean location plate of BSA_ROOM, Baltimore School for the Arts theater classroom in late "
     "1980s, no characters, no people, wooden stage floor, stacked chairs, paperback Shakespeare "
     "editions on a table, tall windows with soft daylight, chalkboard with illegible marks, "
     "eye-level observational camera, no readable text"),
    ("stage_du",
     "clean location plate of STAGE_DU, small early-1990s hip-hop club stage empty before a show, "
     "no characters, no people, low stage with monitors, wired mics on stands, warm amber and red "
     "gels, brick back wall, period PA stack, smoky haze, eye-level observational camera, "
     "no text, no logos"),
]

FRAMES = [
    ("01",
     "TUPAC20 at age 20 standing at the edge of a modest 1991 Los Angeles street crowd, relaxed "
     "stance, looking past camera, blurred passersby behind him, period cars and storefronts, "
     "late-afternoon sun, preserve TUPAC20 face and build exactly from anchor, "
     "no text, no speech bubbles, single frame"),
    ("02",
     "TUPAC20 seated across from MANNA inside VALLEY_HOME from anchor, small cassette recorder and "
     "closed notebook on coffee table with no readable writing, AFENI91 visible soft in background "
     "doorway, vertical-blind daylight stripes, preserve TUPAC20, MANNA and AFENI91 identities "
     "exactly, calm introductory conversation, no text, no speech bubbles, single frame"),
    ("03",
     "close observational view of a 1991 Interscope press-kit folder and typewritten biography pages "
     "on a wood desk, all writing intentionally blurred and unreadable, period office with beige "
     "computer and corded phone soft behind, tungsten desk lamp, no readable text, single frame"),
    ("04",
     "young TUPAC20 reading a worn paperback poetry book at a small kitchen table at night, AFENI91 "
     "seated nearby watching with quiet pride, modest 1970s-80s apartment details, warm practical "
     "lamp, preserve TUPAC20 and AFENI91 exactly but TUPAC20 slightly younger styling, books stacked "
     "without readable titles, no text, no speech bubbles, single frame"),
    ("05",
     "TUPAC20 as a teen student in BSA_ROOM from anchor, seated with classmates in a semicircle, "
     "HICKEN standing beside a table of Shakespeare paperbacks gesturing openly, tall window "
     "daylight, preserve TUPAC20 younger likeness and HICKEN identity exactly, curious engaged "
     "classroom energy, no readable text, single frame"),
    ("06",
     "TUPAC20 alone on the BSA_ROOM stage performing a slow expressive movement piece, one arm "
     "extended, head tilted down, single spotlight from above, empty chairs in dark foreground "
     "suggesting an audience, preserve TUPAC20 face exactly, misunderstood-artist solitude, "
     "no text, no speech bubbles, single frame"),
    ("07",
     "TUPAC20 as supporting performer on STAGE_DU from anchor, holding a period wired mic mid-verse, "
     "two adult bandmates in early-90s funk-rap wardrobe soft behind him, packed small club crowd as "
     "blurred silhouettes, warm amber and red stage wash, preserve TUPAC20 face exactly, hungry "
     "first-opportunity energy not triumph, no text, no logos, single frame"),
    ("08",
     "TUPAC20 alone in a modest 1991 recording studio vocal booth, large-diaphragm mic with pop "
     "filter, lyric notebook closed in hand with no readable writing, control-room glass glowing "
     "behind, preserve TUPAC20 exactly, focused pre-debut tension, no text, single frame"),
    ("09",
     "empty 1991 inner-city apartment doorway at dusk, small bundled blanket and worn school backpack "
     "resting on the step, door ajar with warm interior light spilling out, no people, no face, no "
     "distress depicted, quiet absence suggesting a vulnerable girl the song asks the audience to stay "
     "with, period brick and iron railing, no text, single frame"),
    ("10",
     "TUPAC20 walking alone at night on a wet 1991 city sidewalk under sodium streetlights, distant "
     "police cruiser lights blurred far behind him, hands in jacket pockets, tense but nonviolent body "
     "language, no officer closeup, no weapon visible, no confrontation, preserve TUPAC20 exactly, "
     "period cars and chain-link fence, no text, single frame"),
    ("11",
     "over-shoulder view of TUPAC20 writing in a spiral notebook at a small desk at night, pen "
     "mid-line, pages intentionally blurred and unreadable, desk lamp pool of light, cinderblock wall "
     "with taped playbills blurred beyond reading, preserve TUPAC20 hands and profile exactly, "
     "empathetic writer focus, no readable text, single frame"),
    ("12",
     "TUPAC20 seated alone on the concrete steps of VALLEY_HOME at blue hour, elbows on knees, "
     "thoughtful unguarded expression, screen door glowing behind, quiet residential street soft "
     "behind, preserve TUPAC20 exactly, sincere negotiation between ambition and responsibility, "
     "no text, single frame"),
    ("13",
     "TUPAC20 standing with three young male friends in early-90s streetwear in a narrow 1991 "
     "apartment hallway, one doorway of warm light open ahead of them, mixed expressions of pride and "
     "unspoken pressure, preserve TUPAC20 exactly, friends as natural background participants not "
     "reference characters, no text, single frame"),
    ("14",
     "AFENI91 seated by a sunlit window reading a sealed envelope with no readable writing, framed "
     "1991 photo of TUPAC20 blurred on the side table, vase of dry flowers, calm affection alongside "
     "hardship, preserve AFENI91 exactly, no readable text, single frame"),
    ("15",
     "low-angle close view of TUPAC20 gripping a period wired mic on STAGE_DU, mouth mid-line, eyes "
     "direct and earnest, crowd bokeh below him, warm stage haze, preserve TUPAC20 exactly, confident "
     "beside uncertainty, no text, no speech bubbles, single frame"),
]

SAFER_SUFFIX = (", symbolic, distant, non-graphic, no wounds, no blood, no distress, "
                "peaceful documentary tone, keep identities, 1991 setting, composition and meaning")


TARGET_W, TARGET_H = 1920, 1280


def fit_1920x1280(path: str) -> tuple:
    """Cover-resize + center-crop any render to exactly 1920x1280. Returns (w, h) before fit."""
    from PIL import Image
    img = Image.open(path).convert("RGB")
    orig = img.size
    scale = max(TARGET_W / img.width, TARGET_H / img.height)
    resample = getattr(Image, "LANCZOS", None) or Image.Resampling.LANCZOS
    img = img.resize((round(img.width * scale), round(img.height * scale)), resample)
    left = (img.width - TARGET_W) // 2
    top = (img.height - TARGET_H) // 2
    img.crop((left, top, left + TARGET_W, top + TARGET_H)).save(path, "WEBP", quality=92)
    return orig


def create(client, prompt, prev=None):
    # NOTE: live API rejects tools=[{type:image_generation,...}] with
    # "`tools[0]` did not match any supported type", so generate at default
    # size and fit to 1920x1280 locally (same 3:2 aspect as 1536x1024).
    kwargs = {"model": MODEL, "input": prompt}
    if prev:
        kwargs["previous_response_id"] = prev
    return client.responses.create(**kwargs)


def run_turn(client, prompt_full, prev, out_path, label, log_fh, retries=1):
    safety_block = False
    try:
        turn = create(client, prompt_full, prev)
    except Exception as e:
        msg = str(e)
        print(f"[{label}] ERROR first attempt: {msg[:300]}")
        low = msg.lower()
        safety_block = any(k in low for k in ("moderation", "safety", "blocked", "filter",
                                              "violence", "graphic", "policy"))
        if retries > 0 and safety_block:
            # Safety rewrite per prompt.md: preserve identities/setting/composition, go non-graphic.
            safer = prompt_full + SAFER_SUFFIX
            print(f"[{label}] safety block -> retrying with safer rewrite...")
            time.sleep(3)
            turn = create(client, safer, prev)
            with open(os.path.join(BASE, "chain_log.jsonl"), "a", encoding="utf-8") as lf:
                lf.write(json.dumps({"label": label, "safety_rewrite": True}) + "\n")
        else:
            raise
    save_image(image_b64(turn), out_path)
    orig = fit_1920x1280(out_path)
    usage = getattr(turn, "usage", None)
    try:
        u = {"input": usage.input_tokens, "output": usage.output_tokens, "total": usage.total_tokens}
    except Exception:
        u = str(usage)
    print(f"[{label}] id={turn.id} usage={u} native={orig} -> {out_path} (1920x1280)")
    if log_fh:
        log_fh.write(json.dumps({"label": label, "id": turn.id, "usage": u, "file": out_path}) + "\n")
        log_fh.flush()
    return turn


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only-anchors", action="store_true")
    ap.add_argument("--only-frames-from", default=None, help="response id to chain frames from (skips anchors)")
    ap.add_argument("--frame", default=None, help="run single frame number e.g. 03 (requires --only-frames-from)")
    ap.add_argument("--start-frame", default=None, help="start frames from number e.g. 08")
    ap.add_argument("--end-frame", default=None, help="stop frames at number e.g. 07")
    args = ap.parse_args()

    if "MODEL_API_KEY" not in os.environ or not os.environ["MODEL_API_KEY"]:
        raise SystemExit("MODEL_API_KEY missing: $env:MODEL_API_KEY = [System.Environment]::GetEnvironmentVariable('META_API_KEY','User')")

    client = get_client()
    log_path = os.path.join(BASE, "chain_log.jsonl")
    log_fh = open(log_path, "a", encoding="utf-8")
    prev = args.only_frames_from
    ids = {}

    if not args.only_frames_from:
        for name, desc in ANCHORS:
            out = os.path.join(BASE, f"anchor_{name}.webp")
            if os.path.exists(out):
                print(f"[anchor_{name}] exists, skipping (delete to regenerate).")
                continue
            prompt = f"{desc}, {STYLE}"
            turn = run_turn(client, prompt, prev, out, f"anchor_{name}", log_fh)
            prev = turn.id
            ids[f"anchor_{name}"] = prev
        with open(os.path.join(BASE, "anchors_done.json"), "w", encoding="utf-8") as f:
            json.dump({"last_id": prev, "ids": ids}, f, indent=2)
        print("ANCHOR_CHAIN_LAST_ID=" + str(prev))
        if args.only_anchors:
            log_fh.close()
            return

    frames = FRAMES
    if args.frame:
        frames = [x for x in FRAMES if x[0] == args.frame]
        if not frames:
            raise SystemExit(f"frame {args.frame} not found")
    elif args.start_frame:
        frames = [x for x in FRAMES if x[0] >= args.start_frame]
    if args.end_frame:
        frames = [x for x in frames if x[0] <= args.end_frame]

    for num, desc in frames:
        out = os.path.join(BASE, f"frame_{num}.webp")
        if os.path.exists(out):
            print(f"[frame_{num}] exists, skipping (delete to regenerate).")
            continue
        prompt = f"{desc}, {STYLE}"
        turn = run_turn(client, prompt, prev, out, f"frame_{num}", log_fh)
        prev = turn.id
        ids[f"frame_{num}"] = prev

    with open(os.path.join(BASE, "frames_done.json"), "w", encoding="utf-8") as f:
        json.dump({"last_id": prev, "ids": ids}, f, indent=2)
    print("FINAL_LAST_ID=" + str(prev))
    log_fh.close()


if __name__ == "__main__":
    main()
