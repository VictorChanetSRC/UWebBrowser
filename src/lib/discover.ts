import type { LinkItem } from "./engines";

export type DiscoverGroup = {
  category: string;
  items: LinkItem[];
};

/** The Discover catalog. Curated for Unreal Engine developers; everything is pinnable. */
export const discoverCatalog: DiscoverGroup[] = [
  {
    category: "Unreal Engine",
    items: [
      { name: "benui", url: "https://benui.ca", hint: "UE UI and C++ reference" },
      { name: "Tom Looman", url: "https://www.tomlooman.com", hint: "UE C++ tutorials and courses" },
      { name: "Unreal Garden", url: "https://unreal-garden.com", hint: "Community UE tutorials" },
      { name: "Unreal Directive", url: "https://unrealdirective.com", hint: "UE best practices" },
      { name: "UE5 Style Guide", url: "https://github.com/Allar/ue5-style-guide", hint: "Naming conventions" },
      { name: "Blueprint UE", url: "https://blueprintue.com", hint: "Share and browse Blueprints" },
      { name: "Quixel Megascans", url: "https://quixel.com/megascans", hint: "Scanned surfaces and 3D" },
      { name: "MetaHuman Creator", url: "https://metahuman.unrealengine.com", hint: "Epic's realistic characters" },
    ],
  },
  {
    category: "Art & animation",
    items: [
      { name: "Blender", url: "https://www.blender.org", hint: "3D creation suite" },
      { name: "Krita", url: "https://krita.org", hint: "Digital painting" },
      { name: "Inkscape", url: "https://inkscape.org", hint: "Vector graphics" },
      { name: "Material Maker", url: "https://www.materialmaker.org", hint: "Procedural materials" },
      { name: "Cascadeur", url: "https://cascadeur.com", hint: "AI-assisted 3D animation" },
      { name: "RealityScan", url: "https://www.realityscan.com", hint: "Epic's photogrammetry" },
      { name: "Mixamo", url: "https://www.mixamo.com", hint: "Auto-rigged characters" },
    ],
  },
  {
    category: "Audio",
    items: [
      { name: "Audacity", url: "https://www.audacityteam.org", hint: "Audio editor" },
      { name: "LMMS", url: "https://lmms.io", hint: "Free music production" },
      { name: "Bosca Ceoil Blue", url: "https://yurisizov.itch.io/boscaceoil-blue", hint: "Beginner-friendly music" },
      { name: "jsfxr", url: "https://sfxr.me", hint: "Retro SFX in the browser" },
      { name: "ChipTone", url: "https://sfbgames.itch.io/chiptone", hint: "SFX generator" },
      { name: "Freesound", url: "https://freesound.org", hint: "CC sound library" },
      { name: "Sonniss GDC bundles", url: "https://sonniss.com/gameaudiogdc", hint: "Gigabytes of free SFX" },
      { name: "FMOD", url: "https://www.fmod.com", hint: "Adaptive audio middleware" },
      { name: "Wwise", url: "https://www.audiokinetic.com", hint: "Audio middleware, UE integration" },
    ],
  },
  {
    category: "Assets",
    items: [
      { name: "Kenney", url: "https://kenney.nl/assets", hint: "Thousands of free assets" },
      { name: "itch.io assets", url: "https://itch.io/game-assets", hint: "Indie asset marketplace" },
      { name: "OpenGameArt", url: "https://opengameart.org", hint: "Free art and audio" },
      { name: "Poly Haven", url: "https://polyhaven.com", hint: "HDRIs, textures, models" },
      { name: "ambientCG", url: "https://ambientcg.com", hint: "CC0 PBR materials" },
      { name: "Quaternius", url: "https://quaternius.com", hint: "CC0 low-poly packs" },
      { name: "game-icons.net", url: "https://game-icons.net", hint: "4000+ free icons" },
      { name: "Sketchfab", url: "https://sketchfab.com", hint: "3D model marketplace" },
    ],
  },
  {
    category: "Tools & workflow",
    items: [
      { name: "Rider", url: "https://www.jetbrains.com/rider/", hint: "C++ IDE with UE support" },
      { name: "RenderDoc", url: "https://renderdoc.org", hint: "Graphics frame debugger" },
      { name: "Shadertoy", url: "https://www.shadertoy.com", hint: "Shader playground" },
      { name: "Twine", url: "https://twinery.org", hint: "Interactive fiction" },
      { name: "ink", url: "https://www.inklestudios.com/ink/", hint: "Narrative scripting, UE plugin" },
      { name: "Machinations", url: "https://machinations.io", hint: "Game economy design" },
    ],
  },
  {
    category: "Learning & content",
    items: [
      { name: "Unreal Engine on YouTube", url: "https://www.youtube.com/@UnrealEngine", hint: "Official channel and Unreal Fest talks" },
      { name: "Mathew Wadstein", url: "https://www.youtube.com/@MathewWadsteinTutorials", hint: "WTF Is? node encyclopedia" },
      { name: "Ryan Laley", url: "https://www.youtube.com/@RyanLaley", hint: "UE tutorial series" },
      { name: "GDC on YouTube", url: "https://www.youtube.com/@Gdconf", hint: "Free conference talks" },
      { name: "GMTK", url: "https://www.youtube.com/@GMTK", hint: "Game design essays" },
      { name: "Freya Holmér", url: "https://www.youtube.com/@acegikmo", hint: "Math for game devs" },
      { name: "Red Blob Games", url: "https://www.redblobgames.com", hint: "Interactive algorithms" },
      { name: "Game Programming Patterns", url: "https://gameprogrammingpatterns.com", hint: "Free book" },
    ],
  },
  {
    category: "Marketing & analytics",
    items: [
      { name: "SteamDB", url: "https://steamdb.info", hint: "Steam data explorer" },
      { name: "Gamalytic", url: "https://gamalytic.com", hint: "Steam market analytics" },
      { name: "VG Insights", url: "https://vginsights.com", hint: "Market research" },
      { name: "How To Market A Game", url: "https://howtomarketagame.com", hint: "Chris Zukowski's playbook" },
      { name: "GameDiscoverCo", url: "https://newsletter.gamediscover.co", hint: "Discoverability newsletter" },
      { name: "presskit()", url: "https://dopresskit.com", hint: "Press kits made simple" },
      { name: "Keymailer", url: "https://www.keymailer.co", hint: "Keys to creators" },
    ],
  },
  {
    category: "Communities & events",
    items: [
      { name: "r/gamedev", url: "https://www.reddit.com/r/gamedev/", hint: "The big subreddit" },
      { name: "TIGSource forums", url: "https://forums.tigsource.com", hint: "Indie devlogs" },
      { name: "itch.io jams", url: "https://itch.io/jams", hint: "Jam calendar" },
      { name: "Ludum Dare", url: "https://ldjam.com", hint: "The classic jam" },
      { name: "Global Game Jam", url: "https://globalgamejam.org", hint: "Worldwide, once a year" },
      { name: "GameDev.net", url: "https://www.gamedev.net", hint: "Forums and articles" },
      { name: "IndieDB", url: "https://www.indiedb.com", hint: "Indie game database" },
    ],
  },
  {
    category: "Ship & publish",
    items: [
      { name: "Steamworks", url: "https://partner.steamgames.com", hint: "Steam partner portal" },
      { name: "Steamworks docs", url: "https://partner.steamgames.com/doc/home", hint: "Official documentation" },
      { name: "Epic Dev Portal", url: "https://dev.epicgames.com/portal", hint: "Epic Games Store" },
      { name: "itch.io dashboard", url: "https://itch.io/dashboard", hint: "Your itch.io games" },
      { name: "Game Jolt", url: "https://gamejolt.com", hint: "Indie game platform" },
      { name: "Newgrounds", url: "https://www.newgrounds.com", hint: "Web games with history" },
    ],
  },
];
