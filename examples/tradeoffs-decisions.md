type: decision
tags: prioritization, simplicity, automation, cost, reliability

## Segment the network before optimizing other layers
### context
At Mike Davis I found a flat network where internal systems, SAP-related traffic, staff access, and even public-facing store usage were mixed together.

### options
I could have kept solving isolated symptoms first, but that would not have fixed the structural risk underneath.

### decision
I started with segmentation and infrastructure cleanup because that reduced the main risk first and gave the rest of the work a proper base.

### impact
It was not the most visible change on day one, but it made the environment much safer and easier to control.

## Start simple and evolve when the signal is clear
### context
In operations and automation work, I usually need fast signal before I need a polished first version.

### options
I can overdesign the first version, or I can build a smaller controlled version first and improve it once I know it is the right direction.

### decision
I usually start with the simplest version that gives me useful feedback quickly, then improve it in steps.

### impact
That keeps momentum up and avoids wasting time on complexity that might not be necessary.

## Avoid fragile dependencies in tax validation
### context
There were tax validation flows depending on fragile browser-based behavior, which made the process harder to control and recover.

### options
I could keep patching the browser path, or move it to a more controlled standalone process.

### decision
I moved it toward a command-line and standalone approach, because it was easier to control, automate, and troubleshoot.

### impact
It took more effort up front, but it became much more predictable in production.

## Reduce cost without losing control
### context
A big part of the work included suppliers, internet contracts, hardware, and infrastructure choices with direct cost impact.

### options
I could leave the setup untouched, or revisit contracts and equipment with cost and operational value in mind.

### decision
I pushed for renegotiation, gradual modernization, and cheaper options only when they did not make the operation weaker.

### impact
The result was lower cost with better control, not cost-cutting for its own sake.
