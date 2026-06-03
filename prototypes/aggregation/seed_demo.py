"""Seed a live demo of the favorite-vs-consensus headline on the dev server.

Creates two ranked_choice polls in ONE group with the SAME 7 friend-group
restaurant ballots — one set to 'favorite' (IRV), one to 'consensus' (Borda) —
then votes + closes both so the divergence is visible side by side.
"""

import json
import urllib.parse
import urllib.request
import uuid

BASE = "https://claude-ranked-choice-headlines-cgxpl.dev.whoeverwants.com"
OPTIONS = ["Sushi Bar", "BBQ Joint", "Thai Place"]
# 3 sushi-clique, 3 bbq-clique (each ranks the other's fave last), 1 thai-lover.
BALLOTS = [
    ("Ana", ["Sushi Bar", "Thai Place", "BBQ Joint"]),
    ("Ben", ["Sushi Bar", "Thai Place", "BBQ Joint"]),
    ("Cleo", ["Sushi Bar", "Thai Place", "BBQ Joint"]),
    ("Dev", ["BBQ Joint", "Thai Place", "Sushi Bar"]),
    ("Esha", ["BBQ Joint", "Thai Place", "Sushi Bar"]),
    ("Finn", ["BBQ Joint", "Thai Place", "Sushi Bar"]),
    ("Gus", ["Thai Place", "Sushi Bar", "BBQ Joint"]),
]


def post(path, body, browser_id, bearer=None):
    data = json.dumps(body).encode()
    req = urllib.request.Request(BASE + path, data=data, method="POST")
    req.add_header("Content-Type", "application/json")
    req.add_header("X-Browser-Id", browser_id)
    req.add_header("Origin", BASE)
    if bearer:
        req.add_header("Authorization", f"Bearer {bearer}")
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def create_poll(winner_method, title, group_id, creator_bid):
    body = {
        "creator_name": "Maya",
        "response_deadline": None,
        "title": title,
        "questions": [{
            "question_type": "ranked_choice",
            "category": "restaurant",
            "options": OPTIONS,
            "winner_method": winner_method,
        }],
    }
    if group_id:
        body["group_id"] = group_id
    return post("/api/polls", body, creator_bid)


def vote(poll_id, question_id, name, ranking):
    bid = str(uuid.uuid4())
    body = {"voter_name": name, "items": [{
        "question_id": question_id,
        "vote_type": "ranked_choice",
        "ranked_choices": ranking,
    }]}
    post(f"/api/polls/{poll_id}/votes", body, bid)


def create_poll_auth(winner_method, title, group_id, creator_bid, bearer):
    return create_poll(winner_method, title, group_id, creator_bid) if False else _create_auth(
        winner_method, title, group_id, creator_bid, bearer)


def _create_auth(winner_method, title, group_id, creator_bid, bearer):
    body = {
        "creator_name": "Maya",
        "response_deadline": None,
        "title": title,
        "questions": [{
            "question_type": "ranked_choice",
            "category": "restaurant",
            "options": OPTIONS,
            "winner_method": winner_method,
        }],
    }
    if group_id:
        body["group_id"] = group_id
    return post("/api/polls", body, creator_bid, bearer=bearer)


def main():
    # Mint a real (recovery-less) account so the screenshot browser can sign
    # into it via the instant-link and view the CLOSED results as a member who
    # joined before close (avoiding the closed-before-join filter).
    link = post("/api/auth/dev/instant-link", {"name": "Maya"}, str(uuid.uuid4()))
    bearer = link["session_token"]
    creator_bid = link["browser_id"]

    consensus = _create_auth("consensus", "Where should we eat Friday?", None, creator_bid, bearer)
    group_id = consensus["group_id"]
    favorite = _create_auth("favorite", "Same ballots, group-favorite method", group_id, creator_bid, bearer)

    for poll in (consensus, favorite):
        qid = poll["questions"][0]["id"]
        for name, ranking in BALLOTS:
            vote(poll["id"], qid, name, ranking)
        post(f"/api/polls/{poll['id']}/close", {}, creator_bid, bearer=bearer)

    for label, poll in (("CONSENSUS", consensus), ("FAVORITE", favorite)):
        qid = poll["questions"][0]["id"]
        with urllib.request.urlopen(BASE + f"/api/questions/{qid}/results", timeout=30) as r:
            res = json.load(r)
        print(f"{label:9} headline winner = {res['winner']!r} "
              f"(favorite={res.get('ranked_choice_winner')!r}, "
              f"consensus={res.get('consensus_winner')!r}, method={res.get('winner_method')!r})")

    group_short = consensus.get("group_short_id")
    detail = f"/g/{group_short}/p/{consensus.get('short_id')}"
    signin = f"{link['url']}&next={urllib.parse.quote(detail, safe='')}"
    print(f"\nGroup (open via sign-in): {link['url']}&next={urllib.parse.quote('/g/' + group_short, safe='')}")
    print(f"Consensus result (sign-in link): {signin}")


if __name__ == "__main__":
    main()
