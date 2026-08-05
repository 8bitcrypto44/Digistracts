"""Shrink digistracts.js by shortening project-owned identifiers.

Only names in SAFE are touched. Browser/DOM/Web-Audio members, anything that
also appears inside a string literal, and names read dynamically are excluded,
so the rename is a pure textual substitution outside of strings and comments.
"""
import re

SAFE = """
state GROUND messageTimer audioCtx facing platforms rectsOverlap enemies
musicTrack bossMode masterGain showOverlay bullets shootCD hunter particles
ensureAudio bossPickups flying onGround camX updateHUD levelTime vulnerable
beamFuel invuln explode stopMusic bindTouch banner beamTick hurtPlayer
enemySpeed antiCampCD muted alive beamAim startTechno handleStartAction beep
ROOT taken playerHP enemyRate airSupers spawnTimer droneTimer drawSprite
buildLevel platformCamp elevated hideOverlay damageEnemy qrCount levelTick
imgs staffs prevBottom groundBots plat musicOn beaming vertical shoulder
trackPromise lastSpaceTap walk startBoss gunPose fromRight advanceFromClear
onLevelComplete drawPlayerGun drawGlobeShield laserY isHoleAt drawCity
bossHand spawnEnemy shootGun landOnPlatform BACKGROUND_SRC kind mode
startBossGame drawPlatforms holes baseY superJump holeCount droneDive crouch
PREACHER_SRC spin limb endX elbow startBtn respawnX levelNow fireHeld
forceFlying firePressed campingHigh addPlatform firing updatePlay updateBoss
superJumps spawnDrone makePlayer inputShoot ROBOT_SRCS swing hitCD targets
lastTap bossBtn LEVELS phase drawBoss drawPlay GUNP PAL levelBanner
bossEye bossFireEye eyeCD eyeFire eyeCharge drawFireball drawBullet drawPickupQR drawPickupGun drawBossHealth drawBossGun
laserAimX laserAimY slamX skyRise skyHold skySlam bindJoystick
failTeam continueAfterFail startCredits updateCredits drawCredits
CREDIT_LINES failRespawnX creditY creditDone missionDoneOverlay
deathBeep grace talkQ talkI talkT calm speedT goldT lime blueN
failAt qrPlats staffPlats respawn
""".split()

# Members owned by the browser that happen to share a name with a project
# identifier. The receiver still gets renamed; only the member name is kept.
PROTECTED = [("audioCtx", "state"), ("musicTrack", "muted")]

# Receivers whose properties belong to the browser, not to this game.
BROWSER_OBJECTS = ["audioCtx", "musicTrack", "ctx", "canvas", "document", "window"]

# Canvas calls are the densest repeated text in the file. Aliasing them once is
# worth ~1.5k characters, which is pure headroom for artwork.
CTX_ANCHOR = "ctx.imageSmoothingEnabled = false;"
CTX_ALIASES = (
    "var FS=function(c){ctx.fillStyle=c},GA=function(v){ctx.globalAlpha=v},"
    "FR=ctx.fillRect.bind(ctx),BP=ctx.beginPath.bind(ctx),"
    "SV=ctx.save.bind(ctx),RS=ctx.restore.bind(ctx);"
)
CTX_NAMES = ["FS", "GA", "FR", "BP", "SV", "RS"]
CTX_REWRITES = [
    (r"ctx\.fillStyle\s*=\s*([^;\n]+?);", r"FS(\1);"),
    (r"ctx\.globalAlpha\s*=\s*([^;\n]+?);", r"GA(\1);"),
    (r"ctx\.fillRect\(", "FR("),
    (r"ctx\.beginPath\(\)", "BP()"),
    (r"ctx\.save\(\)", "SV()"),
    (r"ctx\.restore\(\)", "RS()"),
]

SPLIT = re.compile(
    r"""("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|//[^\n]*|/\*.*?\*/)""",
    re.S,
)
WORD = re.compile(r"[A-Za-z_$][A-Za-z0-9_$]*")
ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"


def _short_names(taken):
    for a in ALPHABET:
        if a not in taken:
            yield a
    for a in ALPHABET:
        for b in ALPHABET + "0123456789":
            if a + b not in taken:
                yield a + b


def _check_browser_members(code):
    allowed = set(PROTECTED)
    for receiver in BROWSER_OBJECTS:
        for m in re.finditer(r"\b%s\.([A-Za-z_$][A-Za-z0-9_$]*)" % receiver, code):
            member = m.group(1)
            if member in SAFE and (receiver, member) not in allowed:
                raise SystemExit(
                    "mangle: %s.%s is a browser property but %r is in SAFE; "
                    "add it to PROTECTED or drop it from SAFE" % (receiver, member, member)
                )


def mangle(source):
    parts = SPLIT.split(source)
    code_only = "".join(parts[::2])
    taken = set(WORD.findall(source))
    reserved = {"M", "PN"} | set(CTX_NAMES)
    assert not reserved & taken, "alias name already used in source"
    assert CTX_ANCHOR in source, "canvas alias anchor missing"
    taken |= reserved
    _check_browser_members(code_only)

    present = [n for n in SAFE if re.search(r"\b%s\b" % re.escape(n), code_only)]
    # Longest first so nothing is renamed into a name still awaiting rename.
    present.sort(key=len, reverse=True)

    supply = _short_names(taken)
    mapping = {}
    for name in present:
        short = next(supply)
        taken.add(short)
        mapping[name] = short

    pattern = re.compile(r"\b(%s)\b" % "|".join(re.escape(n) for n in mapping))
    sentinels = {m: "\x00%d\x00" % i for i, (_, m) in enumerate(PROTECTED)}
    for i in range(0, len(parts), 2):
        for receiver, member in PROTECTED:
            parts[i] = re.sub(
                r"(\b%s\.)%s\b" % (re.escape(receiver), re.escape(member)),
                lambda m: m.group(1) + sentinels[member],
                parts[i],
            )
        parts[i] = pattern.sub(lambda m: mapping[m.group(1)], parts[i])
        for member, token in sentinels.items():
            parts[i] = parts[i].replace(token, member)
        parts[i] = parts[i].replace("Math.", "M.").replace("performance.now()", "PN()")

    out = "".join(parts)
    out = out.replace(CTX_ANCHOR, CTX_ANCHOR + CTX_ALIASES, 1)
    head, sep, body = out.partition(CTX_ALIASES)
    for pattern, replacement in CTX_REWRITES:
        body = re.sub(pattern, replacement, body)
    return "var M=Math,PN=performance.now.bind(performance);" + head + sep + body
