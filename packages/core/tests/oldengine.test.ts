import { test } from "node:test";
import assert from "node:assert/strict";

// iOS 15–16, older Android WebViews and older desktop installers predate the RegExp `v` flag and throw a
// SyntaxError for it. This file stands in for such an engine before loading the module, so it must not
// import the module statically: the import would run before the stand-in is in place.

const NativeRegExp = RegExp;
const rejectedFlags: string[] = [];

/** A RegExp constructor that throws for the `v` flag, as engines without it do. */
const RegExpWithoutVFlag = new Proxy(NativeRegExp, {
    construct(target, args: [string | RegExp, string?], newTarget) {
        const flags = args[1] ?? "";
        if (flags.includes("v")) {
            rejectedFlags.push(flags);
            throw new SyntaxError(`Invalid flags supplied to RegExp constructor '${flags}'`);
        }
        return Reflect.construct(target, args, newTarget);
    },
});

test("header normalization loads and keeps emoji on an engine without the v flag", async () => {
    globalThis.RegExp = RegExpWithoutVFlag;
    try {
        const { normalizeHeaderForLink } = await import("../src/index");
        assert.equal(normalizeHeaderForLink("👩‍💻 Work / 🇨🇳 Trip"), "👩‍💻 Work 🇨🇳 Trip");
        assert.equal(normalizeHeaderForLink("📅 Plan: week 38"), "📅 Plan week 38");
    } finally {
        globalThis.RegExp = NativeRegExp;
    }
    assert.ok(rejectedFlags.length > 0, "the module should try the v flag first");
});
