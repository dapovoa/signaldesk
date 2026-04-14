type: decision
tags: decisions, tradeoffs, priorities

## Network segmentation first
### context
Internal systems, SAP-related traffic, staff access, and public-facing store usage shared the same flat network.

### options
Solve isolated symptoms first.
Fix structural network risk first.

### choice
Segmentation and infrastructure cleanup first.

### reason
Largest risk reduced first.
Better base for later work.

### impact
Safer environment.
Better control.

## Start simple before polishing
### context
Operations and automation work often needed early signal before polish.

### options
Overdesign first version.
Build smaller controlled version first.

### choice
Simplest useful version first.
Improve in steps afterwards.

### impact
Faster feedback.
Less unnecessary complexity.

## Move tax validation away from fragile browser flows
### context
Tax validation steps depended on brittle browser behaviour.

### options
Keep patching browser path.
Move to controlled standalone process.

### choice
Command-line and standalone approach.

### reason
Better control.
Better troubleshooting.
Better automation.

### impact
Higher predictability in production.

## Reduce cost without weakening operations
### context
Suppliers, internet contracts, hardware, and infrastructure choices had direct cost impact.

### options
Leave setup unchanged.
Revisit contracts and equipment with operational value in mind.

### choice
Renegotiation and gradual modernisation.

### reason
Lower cost only when operations remained strong.

### impact
Lower cost.
Better control.
