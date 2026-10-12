# Endpoint examples

Each YAML file contains one habit item for the `habits:` list in `Habit Logs/Settings.md`. Copy the item into that list, change its `id` if it conflicts with an existing habit, then configure any required credentials in Obsidian Secret Storage using the `secretKey` name shown in the file.

These examples use one HTTP request and a JSON response per sync. Check the service's current API documentation and adjust its URL, authentication, and response mapping as needed.

## Connected APIs

- [GitHub contributions](github-contributions.yaml) — GitHub GraphQL contribution calendar.
- [Monkeytype typing duration](monkeytype-typing-duration.yaml) — sums test durations and converts seconds to minutes.
- [Duolingo streak](duolingo-streak.yaml) — daily snapshot; replace `YOUR_USERNAME` with the public profile username.

## API gallery

- [NASA/JPL Moon distance](nasa-horizons-moon-distance.yaml) — daily geocentric distance snapshot in kilometres.
- [NASA/JPL close approaches](nasa-close-approaches.yaml) — counts returned asteroid and comet close approaches on their event dates.
- [London humidity](open-meteo-london-humidity.yaml) — current relative humidity from Open-Meteo; no API key required.
- [Home Assistant temperature](home-assistant-temperature.yaml) — averages returned state changes; replace the host and entity ID and add a token.
- [PubMed research count](pubmed-sleep-research.yaml) — rolling seven-day count stored as today's snapshot.
- [USGS earthquake count](endpoint-smoke-test-usgs.yaml) — daily count of magnitude 2.5+ earthquakes.

