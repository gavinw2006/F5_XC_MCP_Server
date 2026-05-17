---
name: Project implementation state
description: Which use cases have been implemented and where the tool files live
type: project
---

As of 2026-05-18, UC-4 was live-tested against anz-partners tenant and all quirks fixed. UC-5 through UC-9 are also implemented.

**Tool files in src/tools/:**
- api-security.ts — UC-4: api_definitions, app_api_groups, xc_upload_swagger_spec (NEW), xc_list_swagger_specs (NEW), xc_delete_swagger_spec (NEW), xc_raw_request
- dns.ts — UC-5: primary/secondary zones, record updates, zone delete
- waf-scanning.ts — UC-6: web_app_scanners CRUD + xc_scan_enable_on_lb
- dns-lb.ts — UC-7: dns_load_balancers CRUD (GSLB weighted/geographic/failover)
- observability.ts — UC-8: healthchecks CRUD (HTTP+DNS), alert_policies CRUD
- customer-edge.ts — UC-9: CE tokens, site list/get/delete, Terraform HCL for Azure/AWS/GCP

All registered in src/index.ts. Build passes (`npm run check && npm run build` both clean).

**Why:** Expanding coverage per mission tasks 1-6 assigned at session start.

**How to apply:** When asked about tool coverage, these UCs are fully implemented. When asked about a specific API pattern, check the relevant tool file first.
