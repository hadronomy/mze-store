# MZE human output prototype

Throwaway UI prototype for the question: which human-output structure makes
`mze` easiest to scan during development work?

Run it from the repository root:

```sh
python3 -m http.server 4173 --directory tooling/mze/prototype
```

Open `http://localhost:4173/human-output.html?variant=A`.

- `A` — dense event rail
- `B` — runbook summary
- `C` — command-center view

Use the bottom switcher or the left and right arrow keys. Click `success` to
inspect the route-conflict failure state. This prototype is not production UI.
