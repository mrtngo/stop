# STOP Multiplayer Web App

Real-time multiplayer web app for the game **STOP** (also known as categories/scatter style rounds).

## Features

- Create/join private rooms with a short room code
- Host controls for categories and round timer
- Real-time round state with synchronized countdown
- Players can submit answers or call **STOP**
- Automatic scoring:
  - `10` points for a valid unique answer
  - `5` points for a valid duplicated answer
  - `0` for blank/invalid answers

## Run locally

1. Install dependencies:

```bash
npm install
```

2. Start the server:

```bash
npm start
```

3. Open:

```text
http://localhost:3000
```

## How to play

1. Host creates a room and shares the room code.
2. Players join with their names.
3. Host optionally edits categories/timer and starts round.
4. Fill one answer per category using the displayed letter.
5. Submit answers before the timer ends, or call STOP to trigger a 5-second final countdown.
6. Review scores and start the next round.

## Notes

- Minimum players per round: `2`
- Answers are checked only by first-letter match (dictionary validation is not enforced)
