# Voice Catalog — Complete Model Inventory

> Full inventory of all voice models available in the KiloCode Voice Studio system.

## Catalog Overview

| Metric | Value |
|--------|-------|
| Total models | 233 voice directories + 2 loose models = 235 catalog entries |
| Total disk usage | ~104 GB / 100 GB cap |
| Model formats | .pth, .onnx, .safetensors, .pt, .ckpt, .index |
| Preview clips | ~235 pre-generated MP3 hero clips |
| Catalog file | `/opt/rvc-models/catalog.json` |
| Metadata overrides | `/opt/rvc-models/catalog/model-metadata.json` |

## How the Catalog Works

```
Model files on disk          model-metadata.json
       │                            │
       ▼                            ▼
  ┌─────────────────────────────────────┐
  │    POST /catalog/rebuild            │
  │  • Scans rvc-voices/ directories    │
  │  • Auto-detects name, gender, size  │
  │  • Merges metadata overrides        │
  │  • Checks for preview clips         │
  └──────────────┬──────────────────────┘
                 │
                 ▼
          catalog.json
                 │
                 ▼
      GET /catalog endpoint
                 │
                 ▼
     Voice Studio Store tab
```

### Auto-Refresh

When new models are added to the VPS, click the **Refresh** button in the Store tab header. This sends `POST /catalog/rebuild` which re-scans all model directories and regenerates `catalog.json`.

## Voice Models — Full Inventory (233 Voices)

### Pop & R&B Artists

| Model | Gender | Description |
|-------|--------|-------------|
| adele | Female | British pop/soul powerhouse |
| aaliyah | Female | R&B vocalist (3 variants: aaliyah, aaliyah-23, aaliyah-33) |
| alicia-keys | Female | R&B/soul vocalist |
| alizee | Female | French pop vocalist (3 variants: alizee, alizee-23, alizee-45) |
| ariana-grande | Female | Pop vocalist (3 variants: ariana-grande, 2010s, 89) |
| avril-lavigne | Female | Pop-punk vocalist |
| bebe-rexha | Female | Pop vocalist |
| beyonce | Female | Pop/R&B icon |
| billie-eilish | Female | Alt-pop vocalist (2 variants: billie-eilish, 2016-2018) |
| billie-joe | Male | Green Day vocalist |
| billy-joel | Male | Piano man |
| bob-marley | Male | Reggae legend |
| brandy | Female | R&B vocalist |
| brent-faiyaz | Male | R&B vocalist |
| britney-spears | Female | Pop icon (2 variants: britney-spears, britney-speaks) |
| bruno-mars | Male | Pop/funk vocalist (3 variants: bruno-mars, bruno-mars-124, brunomars) |
| bryson-tiller | Male | R&B/trap vocalist |
| camila-cabello | Female | Pop vocalist |
| cassie | Female | R&B vocalist |
| charlie-puth | Male | Pop vocalist |
| christina-aguilera | Female | Pop/soul vocalist |
| chris-brown | Male | R&B vocalist |
| chris-martin | Male | Coldplay vocalist |
| damon-albarn | Male | Blur/Gorillaz vocalist |
| doja-cat | Female | Pop/rap artist |
| ed-sheeran | Male | Pop singer-songwriter |
| elvis-presley | Male | King of Rock & Roll |
| frank-sinatra | Male | Classic crooner |
| freddie-mercury | Male | Queen vocalist |
| lady-gaga | Female | Pop icon |
| lil-nas-x | Male | Pop/rap artist |
| michael-jackson | Male | King of Pop |
| nicki-minaj | Female | Rap/pop artist |

### Hip-Hop & Rap

| Model | Gender | Description |
|-------|--------|-------------|
| 21-savage | Male | Atlanta rapper |
| 2pac-tupac | Male | West Coast legend |
| 50-cent | Male | G-Unit rapper |
| 6ix9ine | Male | Controversial rapper |
| 6lack | Male | R&B/rap artist |
| anderson-paak | Male | Rap/R&B vocalist |
| asap-rocky | Male | ASAP Mob rapper |
| baby-keem | Male | pgLang rapper |
| babysantana | Male | SoundCloud rapper |
| babytron | Male | Detroit rapper |
| bad-bunny | Male | Latin trap/reggaeton |
| bbno | Male | Comedy rap |
| biggie-smalls | Male | Brooklyn legend (2 variants) |
| bktherula | Female | Punk rap |
| bones | Male | Underground rapper |
| burnaboy | Male | Afrobeats/rap |
| c-blu | Male | Drill rapper |
| central-cee | Male | UK rapper |
| chief-keef | Male | Drill pioneer |
| childish-gambino | Male | Multi-genre rapper |
| chris-travis | Male | Memphis rapper |
| comethazine | Male | Aggressive rapper |
| cupcakke | Female | Chicago rapper |
| daddy-yankee | Male | Reggaeton pioneer |
| danny-brown | Male | Detroit rapper |
| drake | Male | Toronto rapper |
| eminem | Male | Rap god |
| kanye-west | Male | Hip-hop producer/rapper |
| lil-wayne | Male | Cash Money rapper |

### Latin Artists

| Model | Gender | Description |
|-------|--------|-------------|
| anuel-aa | Male | Latin trap (2 variants) |
| arijit-singh | Male | Bollywood vocalist |
| bryant-myers-8 | Male | Latin trap |
| camilo | Male | Latin pop |
| canserbero | Male | Venezuelan rapper |
| cazzu | Female | Argentine rapper |
| cerati | Male | Soda Stereo vocalist |
| chalino-sanchez | Male | Regional Mexican |
| charly-garcia | Male | Argentine rock |
| chencho | Male | Reggaeton |
| christian-yaipen | Male | Cumbia vocalist |
| dawid-kwiatkowski | Male | Polish pop |

### K-Pop & Asian Artists

| Model | Gender | Description |
|-------|--------|-------------|
| bang-chan | Male | Stray Kids (2 variants) |
| blackpink-jennie-kim | Female | BLACKPINK |
| byun-baekhyun | Male | EXO |
| chenle | Male | NCT Dream |
| choa | Female | AOA |
| chou-tzuyu | Female | TWICE |
| doyoung | Male | NCT |
| katseye-daniela | Female | KATSEYE |
| katseye-manon | Female | KATSEYE |

### Anime & Game Characters

| Model | Gender | Description |
|-------|--------|-------------|
| akira-otoishi | Male | JoJo's Bizarre Adventure |
| all-might | Male | My Hero Academia |
| ami-mizuno | Female | Sailor Moon (Mercury) |
| asuka-kazama | Female | Tekken |
| chibiusa | Female | Sailor Moon (Chibi Moon) |
| cortana | Female | Halo AI |
| dabi | Male | My Hero Academia |
| deku | Male | My Hero Academia |
| haruka-tenou | Female | Sailor Moon (Uranus) |
| hotaru-tomoe | Female | Sailor Moon (Saturn) |
| makoto-kino | Female | Sailor Moon (Jupiter) |
| michiru-kaioh | Female | Sailor Moon (Neptune) |
| minako-aino | Female | Sailor Moon (Venus) |
| naru-osaka | Female | Sailor Moon |
| noel-vermillion | Female | BlazBlue |
| rei-hino | Female | Sailor Moon (Mars) |
| setsuna-meioh | Female | Sailor Moon (Pluto) |
| usagi-tsukino | Female | Sailor Moon (Moon) |

### Cartoon & Animated Characters

| Model | Gender | Description |
|-------|--------|-------------|
| badgerclops | Male | Mao Mao character |
| baldi | Male | Baldi's Basics |
| barney | Male | Barney the Dinosaur |
| bart-simpson | Male | The Simpsons |
| bowser | Male | Super Mario |
| boyfriend-fnf | Male | Friday Night Funkin' |
| brian-griffin | Male | Family Guy |
| butt-head | Male | Beavis and Butt-Head |
| cdi-link | Male | CDi Zelda |
| charlie-browns-teacher | Neutral | Peanuts |
| charlie-dompler | Male | Smiling Friends |
| craig-tucker | Male | South Park |
| fern-bfdie | Neutral | Battle for Dream Island |
| homer-simpson | Male | The Simpsons |
| jillian-family-guy | Female | Family Guy |
| lois-griffin | Female | Family Guy |
| luigi | Male | Super Mario |
| mao-mao | Male | Mao Mao: Heroes of Pure Heart |
| meg-griffin | Female | Family Guy (2 variants) |
| patrick-star | Male | SpongeBob |
| peter-griffin | Male | Family Guy |
| rick-sanchez | Male | Rick and Morty |
| rose-bfdie | Female | Battle for Dream Island |
| squidward | Male | SpongeBob |
| stewie-griffin | Male | Family Guy |
| tigress | Female | Kung Fu Panda |
| velma | Female | Scooby-Doo |

### VTubers & Internet Personalities

| Model | Gender | Description |
|-------|--------|-------------|
| amano-pikamee | Female | VTuber |
| amelia-watson | Female | Hololive EN |
| andrew-tate | Male | Internet personality |
| bo-burnham | Male | Comedian/musician |
| brian-wilson | Male | Beach Boys |
| ceres-fauna | Female | Hololive EN |
| chris-chan | Male | Internet personality (2 variants) |
| erik-voss | Male | YouTuber |
| fake-german-kid | Male | Internet meme |
| kidaroo | Male | GoAnimate/Vyond |
| leonidas-slikk | Male | Angry German Kid |
| leopold-slikk | Male | Angry German Kid |
| billy-mays | Male | Infomercial host |

### Political & Public Figures

| Model | Gender | Description |
|-------|--------|-------------|
| biden | Male | US President |
| binyamin-netanyahu-67 | Male | Israeli PM |
| morgan-freeman | Male | Actor/narrator |

### Game Characters

| Model | Gender | Description |
|-------|--------|-------------|
| alyx-vance | Female | Half-Life 2 |
| arne-magnusson | Male | Half-Life 2 |
| barney-calhoun | Male | Half-Life 2 |
| coach | Male | Left 4 Dead 2 |
| tommy-vercetti | Male | GTA Vice City |

### AI & Synthetic Voices

| Model | Gender | Description |
|-------|--------|-------------|
| cerevoice-andy | Male | CereProc synthetic |
| dectalk | Neutral | Classic retro TTS |
| gameboy-color | Neutral | Retro gaming synth |
| google-assistant | Neutral | Modern assistant voice |
| google-gemini | Neutral | AI assistant voice |
| liberty-prime | Male | Fallout robot |
| loquendo-juan | Male | Loquendo TTS |
| noaa-radio | Neutral | Weather radio broadcast |
| ntts-ai | Neutral | Neural TTS |

### Studio & Custom Voices

| Model | Gender | Description |
|-------|--------|-------------|
| lunar-studio | Female | High-fidelity studio voice |
| phoenixstorm-default | Neutral | Default test voice |
| witchy-simone | Female | Custom character voice |

### Other / Miscellaneous

| Model | Gender | Description |
|-------|--------|-------------|
| ameer-vann | Male | BROCKHAMPTON |
| andy-hull | Male | Manchester Orchestra |
| ant-clemons | Male | R&B vocalist |
| anthony-green | Male | Circa Survive |
| aran | Male | Voice model |
| aries-of-wunderworld | Male | Indie artist |
| arlan | Male | Voice model |
| arlo | Male | Voice model |
| ayesha-erotica | Female | Internet musician |
| bananirou | Neutral | Voice model |
| barbara-jp-unknown | Female | Japanese voice |
| barik | Male | Voice model |
| barnabas | Male | Voice model |
| bedoes | Male | Polish rapper |
| ben-el | Male | Israeli pop |
| benee | Female | NZ pop artist |
| benrey | Male | HLVR:AI character |
| bill-wurtz | Male | Internet musician |
| bones | Male | TeamSESH |
| brendon-urie-panic-at-the-disco | Male | Panic! vocalist |
| bruno-powroznik | Male | Internet personality |
| bryska-45 | Female | Polish pop |
| bubs-homestar-runner | Male | Homestar Runner |
| c-r-o | Male | Austrian rapper |
| caparezza | Male | Italian rapper |
| casey-lee-williams | Female | RWBY vocalist |
| charlie-scene | Male | Hollywood Undead |
| chase-atlantic | Male | Indie band |
| chester-bennington | Male | Linkin Park (2 variants) |
| chris-cornell-7 | Male | Soundgarden/Audioslave |
| christian-redl | Male | Voice actor |
| cmoon | Neutral | Voice model |
| colin-camacho | Male | Voice model |
| daiwa | Female | Voice model |
| daimer | Neutral | Voice model |
| dave-mustaine | Male | Megadeth |
| dem-jointz | Male | Producer |
| dude-stop-let-me-go | Neutral | Meme voice |
| flain | Male | Voice model |
| hoppus | Male | Blink-182 |
| leah-kazuno | Female | Love Live! |
| mao-hiiragi | Female | Anime character |
| mario-hotel | Male | Voice model |
| masayuki | Male | Voice model |
| not | Neutral | Voice model |
| okabe-rintaro | Male | Steins;Gate |
| oswaldo | Male | Voice model |
| pud-cat | Neutral | Voice model |
| riggy | Male | Voice model |
| roger-waters | Male | Pink Floyd |
| rolf-kanies | Male | Voice actor |
| rosenberg | Male | Voice model |
| sarah-kazuno | Female | Love Live! |
| telekinesis | Neutral | Voice model |
| toei | Neutral | Voice model |
| yuna-hijirisawa | Female | Voice model |
| chano | Male | Voice model |

## Voice Categories Summary

### By Gender

| Gender | Count | Percentage |
|--------|-------|------------|
| Male | ~140 | 60% |
| Female | ~65 | 28% |
| Neutral | ~28 | 12% |

### By Category

| Category | Count | Examples |
|----------|-------|----------|
| Pop/R&B | 33 | Ariana Grande, Beyoncé, Bruno Mars |
| Hip-Hop/Rap | 29 | Drake, Eminem, Kanye West |
| Cartoon/Animated | 27 | Homer Simpson, Peter Griffin, SpongeBob |
| Anime/Game | 20 | Sailor Moon cast, BlazBlue, Tekken |
| Latin | 12 | Bad Bunny, Daddy Yankee |
| K-Pop | 9 | BTS, BLACKPINK, NCT |
| AI/Synthetic | 9 | Google Assistant, DECTalk |
| VTuber/Internet | 13 | Amelia Watson, Bo Burnham |
| Rock | 10 | Chester Bennington, Freddie Mercury |
| Other | ~70 | Various indie, meme, and custom voices |

## Mood Mappings

The Voice Studio search system includes mood quick filters that map to voice attributes:

| Mood | Matching Criteria | Example Matches |
|------|-------------------|-----------------|
| **Warm** | style: natural, tags contain "warm" or "soft", quality >= 3 | Lunar Studio, Elvis Presley |
| **Calm** | style: natural or whisper, tags contain "calm" or "gentle" | Rose (BFDI/E) |
| **Bright** | style: expressive, tags contain "bright", "clear", or "crisp" | Makoto Kino, Ami Mizuno |
| **Deep** | gender: male, tags contain "deep", "bass", or "low" | Liberty Prime, Kanye West |
| **Robotic** | style: broadcast, provider: piper or dectalk | DECTalk, NOAA Radio |
| **Professional** | style: natural, quality >= 4, tags contain "studio" or "neutral" | Lunar Studio, NTTS AI |

## Adding New Models

1. **Place model files** on VPS at `/opt/rvc-models/models/rvc-voices/<model-name>/`
2. **Optionally add metadata** in `/opt/rvc-models/catalog/model-metadata.json`:
   ```json
   {
     "model-name": {
       "name": "Display Name",
       "gender": "female",
       "accent": "en-US",
       "accentLabel": "American English",
       "style": "natural",
       "quality": 4,
       "sampleRate": 24000,
       "tags": ["tag1", "tag2"],
       "description": "Short description of the voice."
     }
   }
   ```
3. **Generate preview clip** by running `generate-all-previews.py` or clicking Refresh in Store
4. **Rebuild catalog** — click Refresh in Voice Studio Store tab, or `POST /catalog/rebuild`
5. New model appears in Store tab immediately

## Catalog JSON Schema

```json
{
  "version": 1,
  "generatedAt": "2026-04-11T04:18:23Z",
  "totalModels": 235,
  "totalSizeBytes": 111669174272,
  "voices": [
    {
      "id": "lunar-studio",
      "name": "Lunar Studio",
      "description": "High-fidelity female studio voice...",
      "gender": "female",
      "accent": "en-US",
      "accentLabel": "American English",
      "style": "natural",
      "quality": 5,
      "sampleRate": 48000,
      "fileSize": 145678901,
      "tags": ["warm", "studio", "hifi", "assistant"],
      "downloadUrl": "/models/lunar-studio",
      "heroClipUrl": "/preview/lunar-studio.mp3",
      "category": "rvc",
      "addedAt": "2026-04-10T12:00:00Z"
    }
  ]
}
```
