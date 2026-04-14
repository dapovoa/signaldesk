type: debugging
tags: incidents, reliability, production, support

## Invoice email failures
### impact
Invoice emails failing in production.
Customers not receiving documents reliably.

### evidence
Queue state.
Logs.

### cause
Weak validation in the flow.
Bad states entering the process.

### changes
Validation fixes.
Retries added.
Logs improved.
Failed items reprocessed.

### result
Same-day stabilisation.
Repeated failures reduced.

## POS data-entry failures
### impact
Bad input accepted in the POS flow.
Operational failures in stores.

### evidence
Real usage flow.
Entry points for bad data.

### cause
Validation happening too late.

### changes
Earlier validation on SAPUI5 side.
Bad input blocked before propagation.

### result
Store errors reduced.
Process less fragile.

## SUSE service instability
### impact
Unstable SUSE Linux services.
Log growth.
Weak recovery.

### evidence
Service behaviour.
Log growth patterns.
Recurring failure patterns.

### changes
Log cleanup jobs.
Alerts.
Automatic recovery checks.

### result
Faster recovery.
Better manageability.

## Chaotic environment with no handover
### impact
Weak ownership.
No documentation.
Fragile dependencies.

### evidence
Access mapping.
Server mapping.
Dependency mapping.
Shared data path mapping.
Critical business system mapping.

### changes
Staged rebuild.
Segmentation.
Rack organisation.
Domain structure.
File structure.
Recovery paths.

### result
Lower operational chaos.
More stable base.
