// The audio resolver (#206): map a beat id to the path of its winning audio take, from the
// `patteraudio.json` manifest Patterpad (or the CLI) emits next to the Audio Folders. It RESOLVES ONLY;
// playback stays the game's. Port of the JS reference's createAudioResolver (packages/play-helpers,
// audio.ts), pinned by the corpus's `audio` section.
//
// The join and the lookup live here, in the std core, so the corpus TestHost checks the resolver games
// use. The plugin's UPatterAudioResolver reads its manifest through readAudioManifest over its own
// FJsonValue, as the TestHost does over its JsonValue: one reader, as parseBundle is for bundles.
#pragma once

#include <map>
#include <optional>
#include <string>
#include <utility>
#include "Patter/BundleJson.h"

namespace patter
{
    /** A manifest's clips: each beat id with its winning take's file, relative to the audio folder. A clip
     *  with an empty file is kept as it was written, and resolves to no take. */
    struct AudioManifest
    {
        std::string schema;
        std::map<std::string, std::string> clips;
    };

    /** Read a parsed `patteraudio.json` into an AudioManifest. J is the host's JSON node type, read
     *  through the same BundleJson<J> and AstJson<J> accessors as parseBundle. Never throws: a root that is
     *  no object, absent `clips`, or a clip with no string `file` reads as no take. */
    template <typename J>
    inline AudioManifest readAudioManifest(const J& root)
    {
        using T = BundleJson<J>;
        using A = AstJson<J>;
        AudioManifest out;
        if (!T::isObject(root)) return out;
        const auto field = [](const J& o, const char* key) -> const J*
        {
            const J* p = T::find(o, key);
            return p && !T::isNull(*p) ? p : nullptr;
        };
        if (const J* p = field(root, "schema"))
            if (A::isString(*p)) out.schema = A::str(*p);
        if (const J* clips = field(root, "clips"))
            if (T::isObject(*clips))
                T::forEachField(*clips, [&](const std::string& beatId, const J& clip)
                {
                    std::string file;
                    if (T::isObject(clip))
                        if (const J* f = field(clip, "file"))
                            if (A::isString(*f)) file = A::str(*f);
                    out.clips[beatId] = file;
                });
        return out;
    }

    /** A manifest and the base path its files live under (wherever the game deployed the audio folder). */
    class AudioResolver
    {
    public:
        AudioResolver() = default;
        AudioResolver(AudioManifest manifest, std::string basePath)
            : manifest_(std::move(manifest)), base_(std::move(basePath)) {}

        /** The full path of a beat's winning take, or nothing when the beat has no take (no clip, or a
         *  clip with no file). Never throws on a missing beat. */
        std::optional<std::string> resolve(const std::string& beatId) const
        {
            auto it = manifest_.clips.find(beatId);
            if (it == manifest_.clips.end() || it->second.empty()) return std::nullopt;
            return join(base_, it->second);
        }

        /** The base and a file joined. A base that already ends in a separator is kept as it stands:
         *  trimming it turned a root such as "/" or "res://" into "" or "res:", and the path lost its root.
         *  An empty base gives the file alone. */
        static std::string join(const std::string& base, const std::string& file)
        {
            const bool separated = base.empty() || base.back() == '/' || base.back() == '\\';
            return separated ? base + file : base + "/" + file;
        }

        const std::string& basePath() const { return base_; }
        const AudioManifest& manifest() const { return manifest_; }

    private:
        AudioManifest manifest_;
        std::string base_;
    };
}
