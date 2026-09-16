// Generated from patterkit/site-chrome; do not edit here, edit the source and run sync
export default {
  "brand": "PatterKit",
  "product": "Patter",
  "wrapClass": "pt-wrap",
  "credit": "Open source under the <a href=\"{base}licensing/\">MIT licence</a>, made by <a href=\"https://ian.wildwinter.net\" rel=\"author\">Ian Thomas</a>.",
  "landing": {
    "mark": "<svg viewBox=\"8 25 124 112\" width=\"33\" height=\"30\" xmlns=\"http://www.w3.org/2000/svg\" aria-hidden=\"true\"><g transform=\"translate(36.7,6) rotate(270 50 50)\"><path fill=\"#214f4b\" d=\"M50 8 C64 30 78 48 78 64 A28 28 0 1 1 22 64 C22 48 36 30 50 8 Z\"></path></g><g transform=\"translate(3.3,56) rotate(90 50 50)\"><path fill=\"#d2603e\" d=\"M50 8 C64 30 78 48 78 64 A28 28 0 1 1 22 64 C22 48 36 30 50 8 Z\"></path></g></svg>",
    "footMark": "<svg viewBox=\"8 25 124 112\" width=\"27\" height=\"24\" xmlns=\"http://www.w3.org/2000/svg\" aria-hidden=\"true\"><g transform=\"translate(36.7,6) rotate(270 50 50)\"><path fill=\"#57a294\" d=\"M50 8 C64 30 78 48 78 64 A28 28 0 1 1 22 64 C22 48 36 30 50 8 Z\"></path></g><g transform=\"translate(3.3,56) rotate(90 50 50)\"><path fill=\"#d2603e\" d=\"M50 8 C64 30 78 48 78 64 A28 28 0 1 1 22 64 C22 48 36 30 50 8 Z\"></path></g></svg>",
    "wordmark": "Patter<span>Kit</span>",
    "nav": [
      {
        "label": "Patterpad",
        "href": "patterpad/overview/"
      },
      {
        "label": "Runtimes",
        "href": "play/overview/"
      },
      {
        "label": "Why Patter",
        "href": "why/"
      },
      {
        "label": "Download",
        "href": "download/"
      },
      {
        "label": "GitHub",
        "href": "https://github.com/patterkit/patter"
      }
    ],
    "cta": {
      "label": "Get started",
      "href": "getting-started/"
    },
    "footNav": [
      {
        "label": "Why Patter",
        "href": "why/"
      },
      {
        "label": "Patterpad",
        "href": "patterpad/overview/"
      },
      {
        "label": "Runtimes",
        "href": "play/overview/"
      },
      {
        "label": "Download",
        "href": "download/"
      },
      {
        "label": "GitHub",
        "href": "https://github.com/patterkit/patter"
      }
    ]
  },
  "downloads": {
    "repo": "patterkit/patter",
    "releases": "https://github.com/patterkit/patter/releases",
    "default": "patterpad",
    "sections": {
      "patterpad": {
        "kind": "release",
        "tag": "^v\\d",
        "strip": "^v",
        "whenMissing": {
          "what": "The Patterpad installers"
        },
        "rows": [
          {
            "name": "macOS",
            "sub": "Signed and notarised <code>.dmg</code> for Apple silicon",
            "asset": "\\.dmg$",
            "label": "Download for macOS"
          },
          {
            "name": "Windows",
            "sub": "One-click installer",
            "asset": "\\.exe$",
            "label": "Download for Windows"
          },
          {
            "name": "Linux",
            "sub": "Self-contained AppImage",
            "asset": "\\.AppImage$",
            "label": "Download for Linux"
          }
        ]
      },
      "plugins": {
        "kind": "engines",
        "strip": "^play-[a-z]+-v",
        "asset": "\\.zip$",
        "label": "Download zip",
        "engines": [
          {
            "key": "js",
            "tag": "^play-js-v\\d",
            "icon": "plugin-javascript.svg",
            "name": "JavaScript",
            "sub": "Web games and apps (TypeScript or JavaScript)"
          },
          {
            "key": "unity",
            "tag": "^play-unity-v\\d",
            "icon": "plugin-unity.svg",
            "name": "Unity",
            "sub": "C# package for <code>Packages/</code>"
          },
          {
            "key": "unreal",
            "tag": "^play-unreal-v\\d",
            "icon": "plugin-unreal.svg",
            "name": "Unreal",
            "sub": "C++ plugin with a sample project"
          },
          {
            "key": "godot",
            "tag": "^play-godot-v\\d",
            "icon": "plugin-godot.svg",
            "name": "Godot",
            "sub": "GDScript addon for <code>addons/</code>"
          }
        ],
        "loose": {
          "engine": "js",
          "asset": "patterplay.min.js",
          "label": "patterplay.min.js",
          "text": "For a plain script tag, {link} is also published on its own."
        }
      },
      "cli": {
        "kind": "release",
        "tag": "^cli-v\\d",
        "strip": "^cli-v",
        "whenMissing": {
          "what": "The CLI binaries"
        },
        "rows": [
          {
            "name": "macOS",
            "sub": "Apple silicon",
            "asset": "macos-arm64",
            "label": "Download",
            "drop": true
          },
          {
            "name": "macOS",
            "sub": "Intel",
            "asset": "macos-x64",
            "label": "Download",
            "drop": true
          },
          {
            "name": "Windows",
            "sub": "x64",
            "asset": "windows.*\\.exe$",
            "label": "Download",
            "drop": true
          },
          {
            "name": "Linux",
            "sub": "x64",
            "asset": "linux-x64",
            "label": "Download",
            "drop": true
          },
          {
            "name": "Linux",
            "sub": "arm64",
            "asset": "linux-arm64",
            "label": "Download",
            "drop": true
          }
        ]
      },
      "tour": {
        "kind": "release",
        "tag": "^tour-v\\d",
        "strip": "^tour-v",
        "whenMissing": {
          "what": "The tour download"
        },
        "rows": [
          {
            "name": "Interactive Tour",
            "sub": "One <code>tour.patterpack</code> file to open in Patterpad",
            "asset": [
              "\\.patterpack$",
              "\\.zip$"
            ],
            "label": "Download the tour"
          }
        ]
      }
    }
  }
};
