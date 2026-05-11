// Brief-provenance contract.
//
// When a section brief declares any sourceNodeId on its measured regions, the brief
// must also carry brief.source.mcpInspections, and every sourceNodeId in the brief
// must trace to some inspection's rootNodeId or childNodeIds.
//
// This makes "I made up the numbers" structurally invalid: an agent without a real
// get_metadata capture cannot author a brief whose regions claim sourceNodeIds, since
// the inspection record would either be absent or fail to cover the claimed ids.
//
// Legacy bundle flows that do not (yet) populate sourceNodeId pass through with no
// enforcement — the contract activates only when at least one region declares a
// sourceNodeId. This makes the schema additions migration-friendly: old briefs keep
// working, new briefs that opt into Figma-First measurement-tracing get the gate.

const REGION_BUCKETS = ["readingOrderTextRegions", "topTextRegions", "topImageRegions"];
const POINT_FIELDS = ["primaryTextBox", "primaryImageBox"];

function collectBriefVariants(brief) {
  const layout = brief?.layout;
  if (!layout || typeof layout !== "object") {
    return [];
  }
  const variants = [];
  if (layout.desktop) variants.push({ breakpoint: "desktop", variant: layout.desktop });
  if (layout.mobile) variants.push({ breakpoint: "mobile", variant: layout.mobile });
  return variants;
}

function* iterateMeasuredRegions(brief) {
  for (const { breakpoint, variant } of collectBriefVariants(brief)) {
    for (const bucket of REGION_BUCKETS) {
      const list = Array.isArray(variant[bucket]) ? variant[bucket] : [];
      for (let i = 0; i < list.length; i += 1) {
        const region = list[i];
        if (region && typeof region.sourceNodeId === "string" && region.sourceNodeId.length > 0) {
          yield {
            breakpoint,
            location: `brief.layout.${breakpoint}.${bucket}[${i}]`,
            name: typeof region.name === "string" ? region.name : null,
            sourceNodeId: region.sourceNodeId
          };
        }
      }
    }
    for (const field of POINT_FIELDS) {
      const region = variant[field];
      if (region && typeof region.sourceNodeId === "string" && region.sourceNodeId.length > 0) {
        yield {
          breakpoint,
          location: `brief.layout.${breakpoint}.${field}`,
          name: typeof region.name === "string" ? region.name : null,
          sourceNodeId: region.sourceNodeId
        };
      }
    }
  }
}

function buildInspectionIndex(brief) {
  const inspections = brief?.source?.mcpInspections;
  if (!Array.isArray(inspections)) {
    return null;
  }
  const byBreakpoint = new Map();
  for (const inspection of inspections) {
    if (!inspection || typeof inspection.breakpoint !== "string") {
      continue;
    }
    const ids = new Set();
    if (typeof inspection.rootNodeId === "string" && inspection.rootNodeId.length > 0) {
      ids.add(inspection.rootNodeId);
    }
    if (Array.isArray(inspection.childNodeIds)) {
      for (const id of inspection.childNodeIds) {
        if (typeof id === "string" && id.length > 0) {
          ids.add(id);
        }
      }
    }
    const existing = byBreakpoint.get(inspection.breakpoint);
    if (existing) {
      for (const id of ids) {
        existing.add(id);
      }
    } else {
      byBreakpoint.set(inspection.breakpoint, ids);
    }
  }
  return byBreakpoint;
}

/**
 * Returns null when the brief is consistent (or when no sourceNodeIds are declared
 * at all, in which case the contract is dormant). Returns an error string when the
 * contract activates and is violated.
 */
export function getBriefProvenanceError(sectionTask) {
  const brief = sectionTask?.brief;
  if (!brief) {
    return null;
  }
  const measuredRegions = [...iterateMeasuredRegions(brief)];
  if (measuredRegions.length === 0) {
    return null; // contract dormant
  }
  const index = buildInspectionIndex(brief);
  if (!index || index.size === 0) {
    const sample = measuredRegions
      .slice(0, 3)
      .map((r) => `${r.location}.sourceNodeId="${r.sourceNodeId}"`)
      .join(", ");
    return (
      `brief declares sourceNodeId on measured regions (${sample}) but ` +
      "brief.source.mcpInspections is missing or empty. Every measured region must trace " +
      "to a real Figma MCP call recorded in mcpInspections."
    );
  }

  const unsourced = [];
  for (const region of measuredRegions) {
    const idsForBreakpoint = index.get(region.breakpoint);
    if (!idsForBreakpoint || !idsForBreakpoint.has(region.sourceNodeId)) {
      unsourced.push(region);
    }
  }
  if (unsourced.length > 0) {
    const sample = unsourced
      .slice(0, 3)
      .map(
        (r) =>
          `${r.location}.sourceNodeId="${r.sourceNodeId}" (no inspection on breakpoint=${r.breakpoint} covers it)`
      )
      .join("; ");
    return (
      `brief region sourceNodeId values are not covered by brief.source.mcpInspections: ${sample}. ` +
      "Add the missing node ids to the matching inspection's childNodeIds, or remove the sourceNodeId " +
      "from regions that were not actually measured via get_metadata."
    );
  }

  return null;
}
