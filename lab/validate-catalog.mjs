import assert from "node:assert/strict";
import { buildFrenchPulseMeta } from "../frenchpulse-meta.js";

const meta = buildFrenchPulseMeta({ tmdbId: 687163, imdbId: "tt0000000", vf: true, vfSource: "DoublageVF", vfVerified: true, status: "nouveaute_vf" });
assert.equal(meta.frenchpulse_meta_version, 1);
assert.equal(meta.vf_verified, true);
assert.equal(meta.status, "nouveaute_vf");
console.log("FrenchPulse shared metadata contract: OK");
