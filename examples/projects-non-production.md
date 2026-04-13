type: project
tags: project, practice, automation, data, backend

## Public transport data pipeline (personal project)
### situation
I built this as a personal project to push myself harder on data pipelines, repeatability, and scheduled processing instead of keeping it at script level.

### what-i-did
I built a GTFS pipeline to download, validate, transform, and load public transport schedule data into PostgreSQL. I used it to think about reruns, scheduling, failure handling, and query performance in a more serious way than a one-off script.

### stack
Python, PostgreSQL, Prefect, Docker

### result
It gave me a good place to practice pipeline structure, performance, and data handling without pretending it was production when it was really a proof of concept.

## Mobile e-commerce integration (proof of concept)
### situation
I built this as a proof of concept to explore a mobile flow connected to internal business systems, especially around SAP-related data.

### what-i-did
I built a FastAPI backend and tested integration paths with SAP-related systems, then connected that to a Flutter/Dart frontend to validate the overall direction. The point was to see where the real complexity lived between mobile, backend, and business systems.

### stack
Python, FastAPI, Flutter, Dart, SAP integration

### result
It helped me validate the architecture and understand where that kind of project would become difficult in practice.

## Infrastructure monitor dashboard (internal tooling)
### situation
I needed a simple way to see whether gateways, services, and store-side infrastructure were alive without depending on anything heavy or overbuilt.

### what-i-did
I built a lightweight dashboard with frequent refresh, simple status indicators, and basic network checks so I could see quickly what was online, what was not, and where I needed to look next.

### stack
PHP, JavaScript, HTML, CSS

### result
It made day-to-day operational checks much faster and gave me a cleaner way to see infrastructure state without overengineering the solution.
