const PROFILE_POLICIES = Object.freeze({
  kik: Object.freeze({
    sharedStyleEntry: "src/input.css",
    primaryStyleStrategy: "tailwind-utilities-primary",
    requiresUtilityMarkup: true,
    requiresSharedCssPolicy: true
  })
});

export function getProfilePolicy(profile = "kik") {
  return PROFILE_POLICIES[profile] ?? PROFILE_POLICIES.kik;
}

export function getSectionVerificationChecks(sectionTask) {
  const checks = [
    "desktopReviewed",
    "mobileReviewed",
    "schemaDerived",
    "runtimeSlotPreserved"
  ];
  const profilePolicy = getProfilePolicy(sectionTask?.profile);

  if (profilePolicy.requiresUtilityMarkup) {
    checks.push("utilityMarkupUsed");
  }
  if (profilePolicy.requiresSharedCssPolicy) {
    checks.push("sharedCssPolicyRespected");
  }
  if (sectionTask?.implementationPolicy?.pattern === "carousel") {
    checks.push("interactionWired", "customElementUsed");
  }
  if (sectionTask?.dataBinding) {
    checks.push("nativeShopifyDataSourceUsed");
  }

  return checks;
}
