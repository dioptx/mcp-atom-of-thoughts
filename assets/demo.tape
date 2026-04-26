# Atom of Thoughts — TUI demo recording
# Render with: vhs assets/demo.tape
# Outputs: assets/demo.gif

Output assets/demo.gif

Set Shell zsh
Set FontSize 14
Set Width 1180
Set Height 720
Set Theme "Catppuccin Mocha"
Set Padding 18
Set TypingSpeed 60ms
Set PlaybackSpeed 1.0

# Cold start — show the launch command so viewers know how to run it
Type "node build/index.js tui --demo"
Sleep 700ms
Enter

# Atoms begin streaming in (driven by the demo event loop, ~700ms each)
# Premises P1, P2, P3 appear automatically; auto-scroll keeps newest selected
Sleep 2400ms

# User scrolls up to inspect P1 — shows navigation works
Type "k"
Sleep 250ms
Type "k"
Sleep 250ms
Type "k"
Sleep 600ms

# Accept P1 — green ✓ appears next to the atom
Type "a"
Sleep 800ms

# Star P1 as critical context
Type "*"
Sleep 700ms

# Reasoning + hypothesis + verification arrive while user watches
Sleep 1400ms

# Open settings to show that's a real surface, not a mock
Type "t"
Sleep 1100ms
# Move down two settings rows, toggle "compact"
Type "j"
Sleep 250ms
Type "j"
Sleep 250ms
Type " "
Sleep 600ms
# Switch theme to soft
Type "j"
Sleep 250ms
Type "j"
Sleep 250ms
Type "j"
Sleep 250ms
Type "l"
Sleep 700ms
# Close settings
Escape
Sleep 700ms

# Show help overlay
Type "?"
Sleep 1500ms
Escape
Sleep 500ms

# Reject the hypothesis with a note — demonstrates granular feedback that
# flows back to the LLM via the check_approval MCP tool
Type "j"
Sleep 200ms
Type "j"
Sleep 200ms
Type "r"
Sleep 600ms
Type "use Prisma include instead of raw .map"
Sleep 700ms
Enter
Sleep 800ms

# Conclusion arrives, gets verified, termination message appears
Sleep 2200ms

# Move to the conclusion and accept it
Type "j"
Sleep 200ms
Type "j"
Sleep 200ms
Type "j"
Sleep 200ms
Type "j"
Sleep 200ms
Type "a"
Sleep 700ms

# Submit the verdict — flash bar shows "verdict NEEDS_REVISION → aot-approval-...json"
Type "s"
Sleep 2500ms

# Quit cleanly
Type "q"
Sleep 500ms
