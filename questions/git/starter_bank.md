# Module: git status

## Exercise: 001

### Title
Check Repository Status

### Type
command

### Difficulty
Easy

### Concepts
git status, working tree

### Scenario
You have modified several files in a local repository and want situational awareness before committing.

### Task
Check the current state of the repository.

### Expected Answer

git status

### Explanation
`git status` shows the current branch, staged changes, unstaged changes, and untracked files.

### Hint
Think about the command that reports repository state without changing anything.

### Hint
It is usually the first command developers run.

### Hint
`git status`

---

## Exercise: 002

### Title
What does a clean working tree mean?

### Type
multiple_choice

### Difficulty
Easy

### Concepts
working tree, git status

### Scenario
`git status` prints: "nothing to commit, working tree clean".

### Task
What does that mean?

### Choices
- A) The repository has no commits yet
- B) There are no unstaged, staged, or untracked changes relative to HEAD (correct)
- C) The remote is up to date
- D) All branches were deleted

### Expected Answer
B

### Explanation
A clean working tree means your working directory and index match HEAD — no pending local changes.

### Hint
Compare the three Git areas: working tree, staging area, and repository.

---

# Module: Staging

## Exercise: 001

### Title
Stage a single file

### Type
command

### Difficulty
Easy

### Concepts
git add, staging area

### Scenario
`app.py` and `config.py` are both modified. You only want `app.py` in the next commit.

### Task
Stage only `app.py`.

### Expected Answer

git add app.py

### Explanation
`git add <path>` copies that path into the staging area (index). Other modified files stay unstaged.

### Hint
You need selective staging, not `git add .`.

---

## Exercise: 002

### Title
Stage everything

### Type
command

### Difficulty
Easy

### Concepts
git add

### Scenario
You reviewed all local changes and want them all staged.

### Task
Stage all changes in the repository.

### Expected Answer

git add .
git add -A
git add --all

### Explanation
`git add .` (or `-A` / `--all`) stages modifications, new files, and deletions across the tree.

### Hint
Use a pathspec that means "everything".

---

## Exercise: 003

### Title
Why not always `git add .`?

### Type
multiple_choice

### Difficulty
Medium

### Concepts
staging, secrets

### Scenario
Your working tree includes `app.py`, `tests/test_app.py`, and `secrets.env`.

### Task
Why might `git add .` be risky?

### Choices
- A) It is slower than adding files one by one
- B) It can accidentally stage secrets or unrelated files (correct)
- C) Git forbids adding more than one file
- D) It deletes untracked files

### Expected Answer
B

### Explanation
Selective staging prevents leaking secrets and keeps commits focused.

---

# Module: Commits

## Exercise: 001

### Title
Create a commit with a message

### Type
command

### Difficulty
Easy

### Concepts
git commit

### Scenario
You already staged the files you want in the snapshot.

### Task
Create a commit with message `Add health endpoint`.

### Expected Answer

git commit -m "Add health endpoint"
git commit -m 'Add health endpoint'

### Explanation
`git commit -m` records a new commit from the staging area with the given message.

### Hint
You need the commit command and a message flag.

---

## Exercise: 002

### Title
Commit without staging first

### Type
output_interpretation

### Difficulty
Easy

### Concepts
staging, commit

### Scenario
Working tree has modifications, staging area is empty. You run `git commit -m "WIP"`.

### Task
What happens?

### Expected Answer
Git refuses / nothing to commit
nothing to commit
aborts because staging area is empty

### Explanation
Commits only include what is in the staging area. With nothing staged, Git reports nothing to commit.

### Hint
Remember which area feeds a commit.

---

# Module: Branches

## Exercise: 001

### Title
Create and switch to a feature branch

### Type
command

### Difficulty
Easy

### Concepts
git switch, branches

### Scenario
You are on `main` and need isolated work for a login feature.

### Task
Create and switch to `feature/login`.

### Expected Answer

git switch -c feature/login
git checkout -b feature/login

### Explanation
`git switch -c` creates a branch at HEAD and checks it out. Older equivalent: `git checkout -b`.

---

## Exercise: 002

### Title
List local branches

### Type
command

### Difficulty
Easy

### Concepts
git branch

### Scenario
You want to see every local branch and which one is current.

### Task
List local branches.

### Expected Answer

git branch

### Explanation
`git branch` lists local branches and marks the current one with `*`.

---

# Module: Reset / Restore / Revert

## Exercise: 001

### Title
Discard working-tree edits to one file

### Type
command

### Difficulty
Easy

### Concepts
git restore, working tree

### Scenario
`src/orders.py` has unwanted local edits. `src/customer.py` has edits you want to keep.

### Task
Discard changes to `src/orders.py` only.

### Expected Answer

git restore src/orders.py
git checkout -- src/orders.py

### Explanation
`git restore <path>` rewrites the working tree file from the index/HEAD without touching other paths.

---

## Exercise: 002

### Title
Unstage without losing edits

### Type
command

### Difficulty
Medium

### Concepts
git restore --staged, staging area

### Scenario
You accidentally staged `secrets.env` but still want to keep the file contents locally.

### Task
Unstage `secrets.env` and keep the working-tree changes.

### Expected Answer

git restore --staged secrets.env
git reset HEAD secrets.env

### Explanation
`--staged` adjusts the index only. A plain `git restore secrets.env` would also wipe working-tree edits.

---

## Exercise: 003

### Title
reset vs restore vs revert

### Type
command_comparison

### Difficulty
Hard

### Concepts
reset, restore, revert

### Scenario
A bad commit was already pushed to a shared remote. Teammates already pulled it.

### Task
Which command family creates a new commit that undoes the bad one on the shared history?

### Expected Answer
git revert
revert

### Explanation
`revert` adds a new compensating commit and is safe for shared history. `reset` rewrites history; `restore` does not move commits.

---

# Module: Stash

## Exercise: 001

### Title
Stash local work

### Type
command

### Difficulty
Medium

### Concepts
git stash

### Scenario
You have uncommitted edits but need a clean tree to switch branches.

### Task
Stash your local modifications.

### Expected Answer

git stash
git stash push
git stash save

### Explanation
`git stash` shelves local modifications and resets the working tree/index to HEAD.

---

# Module: Remote Repositories

## Exercise: 001

### Title
Add origin remote

### Type
command

### Difficulty
Easy

### Concepts
git remote

### Scenario
Your local repo has commits but no remotes.

### Task
Add remote `origin` with URL `https://github.com/example/practice.git`.

### Expected Answer

git remote add origin https://github.com/example/practice.git

### Explanation
`git remote add` only records a URL. It does not fetch or push by itself.

---

# Module: Real-world Git Troubleshooting

## Exercise: 001

### Title
Accidentally staged the wrong file

### Type
debugging

### Difficulty
Medium

### Concepts
staging, restore

### Scenario
You meant to stage `src/api.py` but staged `src/legacy.py`.

### Task
Unstage `src/legacy.py` while keeping its local edits.

### Expected Answer

git restore --staged src/legacy.py
git reset HEAD src/legacy.py

### Explanation
Unstage with restore --staged (or mixed reset of the path). Then you can stage the correct file.

---

## Exercise: 002

### Title
Predict status after restore

### Type
state_prediction

### Difficulty
Medium

### Concepts
git restore, git status

### Scenario
Working tree: modified `a.txt` and `b.txt`. You run `git restore a.txt`, then `git status`.

### Task
Which files still show as modified?

### Expected Answer
b.txt
only b.txt

### Explanation
Restore only affected `a.txt`. `b.txt` remains modified.

---

# Module: Git & Version Control Basics

## Exercise: 001

### Title
Purpose of version control

### Type
multiple_choice

### Difficulty
Easy

### Concepts
version control

### Scenario
A teammate asks why the team uses Git.

### Task
Which statement best describes version control?

### Choices
- A) It compiles code faster
- B) It tracks changes over time and enables collaboration (correct)
- C) It replaces unit tests
- D) It hosts production servers

### Expected Answer
B

### Explanation
Version control records history, supports branching, and helps teams collaborate safely.

---

# Module: git diff

## Exercise: 001

### Title
Inspect unstaged changes

### Type
command

### Difficulty
Easy

### Concepts
git diff

### Scenario
You modified files but have not staged them yet.

### Task
Show the unstaged differences.

### Expected Answer

git diff

### Explanation
`git diff` (with no args) shows working tree vs index — unstaged changes.

---

## Exercise: 002

### Title
Inspect staged changes

### Type
command

### Difficulty
Easy

### Concepts
git diff --staged

### Scenario
Files are already staged and you want to review what will be committed.

### Task
Show staged differences.

### Expected Answer

git diff --staged
git diff --cached

### Explanation
`--staged` / `--cached` compares the index to HEAD.

---

# Module: git log & History

## Exercise: 001

### Title
View compact history

### Type
command

### Difficulty
Easy

### Concepts
git log

### Scenario
You want a concise list of commits on the current branch.

### Task
Show an oneline commit log.

### Expected Answer

git log --oneline

### Explanation
`--oneline` prints abbreviated hashes and subjects — ideal for quick scanning.

---

# Module: Fetch / Pull / Push

## Exercise: 001

### Title
fetch vs pull

### Type
multiple_choice

### Difficulty
Medium

### Concepts
fetch, pull

### Scenario
You want to download remote commits without merging them into your current branch yet.

### Task
Which command should you use?

### Choices
- A) git pull
- B) git fetch (correct)
- C) git push
- D) git merge --abort

### Expected Answer
B

### Explanation
`fetch` updates remote-tracking branches only. `pull` is fetch + integrate.

---

# Module: Merging

## Exercise: 001

### Title
Merge a feature branch

### Type
command

### Difficulty
Medium

### Concepts
git merge

### Scenario
You are on `main`. Feature work lives on `feature/metrics` and can fast-forward.

### Task
Merge `feature/metrics` into your current branch.

### Expected Answer

git merge feature/metrics

### Explanation
While on the receiving branch, `git merge <branch>` integrates that tip.

---

# Module: .gitignore

## Exercise: 001

### Title
Ignore environment files

### Type
multiple_choice

### Difficulty
Easy

### Concepts
gitignore

### Scenario
You do not want `secrets.env` tracked by Git.

### Task
Where should you declare that ignore rule for the whole repo?

### Choices
- A) In a commit message
- B) In `.gitignore` (correct)
- C) In `git status`
- D) In the remote URL

### Expected Answer
B

### Explanation
`.gitignore` lists path patterns Git should treat as untracked by default.
