# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - generic "Time since last compilation (shows if current view reflects latest code changes)": 1h
  - generic [ref=e5]:
    - heading "Real-time Changes Test" [level=1] [ref=e8]
    - generic [ref=e11]:
      - generic [ref=e12]:
        - text: Created by
        - generic [ref=e13]: Creator
        - text: 9/14/25
      - generic [ref=e15]: Closing in 9m 50s
      - generic [ref=e16]:
        - generic [ref=e18]:
          - generic [ref=e19]: "Add new nominations:"
          - textbox "Add a nomination" [ref=e22]
        - button "Abstain" [ref=e25]
      - generic [ref=e26]:
        - generic [ref=e27]: Your name (optional)
        - textbox "Enter your name (optional)" [ref=e28]: Creator
      - button "Submit Vote" [disabled] [ref=e29]
      - button "Close Poll" [ref=e31]
      - button "Forget this poll" [ref=e33]:
        - generic [ref=e34]:
          - img [ref=e35]
          - generic [ref=e37]: Forget this poll
  - button "Copy poll link to clipboard" [ref=e39]:
    - img [ref=e40]
  - generic [ref=e44]:
    - button "Go to home" [ref=e45] [cursor=pointer]:
      - img [ref=e46] [cursor=pointer]
    - button "Profile" [ref=e48] [cursor=pointer]:
      - img [ref=e49] [cursor=pointer]
  - alert [ref=e51]
  - button "Open Next.js Dev Tools" [ref=e57] [cursor=pointer]:
    - img [ref=e58] [cursor=pointer]
```