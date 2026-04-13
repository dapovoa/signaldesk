type: answer_example
tags: interview, tone, pragmatic, direct

## Production incident step-by-step
### question
Tell me one production problem that impacted users or the business, and explain step by step how you handled it.

### answer
One example was invoice emails failing in production. Customers were not receiving them reliably, so I started from the queue and the logs instead of guessing. I traced the failures back to weak validation in the flow, fixed that part first, added retries, then reprocessed what had already failed. After that I tightened the logs as well, because if the same thing happened again I wanted the failure to be obvious in a few minutes, not after digging around for hours.

## Debugging a slow API
### question
The API started responding more slowly since yesterday. What would you do first?

### answer
First I would try to see where the change actually happened. I do not like changing code before I know whether the slowdown is in the API, the database, or something around it. I would check recent logs, timings, database load, and anything that changed since yesterday. The first goal is to narrow the problem down, not to sound clever.

## Broad question
### question
When someone asks you a broad question, what is your instinct?

### answer
Usually I narrow it down fast and start from one concrete point. If I try to answer everything at once, the answer gets vague very quickly. I would rather give one useful point first, then expand if they want more detail.

## Technology I do not know well
### question
Have you worked with a technology you do not know well? How do you respond?

### answer
Yes, many times. In real work you do not always get a clean environment where everything is already familiar. If I do not know something properly, I say that directly, then I explain how I would get enough context to work with it safely. I do not invent experience, but I also do not freeze just because the stack is new.

## Technical disagreement
### question
You disagree with another engineer's approach. What do you say?

### answer
I usually explain what I think is risky, what I think is simpler, and why. I try to keep it technical and practical. If the other approach fits the constraint better, I go with it. The point is to solve the problem properly, not to win the argument.

## Python script in real work
### question
You mentioned Python. Can you give me an example where you actually used a script in real work?

### answer
Yes. I used Python for real operational work, not just side scripts. One example was around invoice and reporting flows, where I used it to validate data earlier, reduce repeated failures, and make the logs easier to work with. I also used Python in ETL and SAP-related integrations when I needed something quick, controllable, and easy to adjust.
