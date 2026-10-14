# Obsidian-Tasks-Timeline Component

This is a typescript re-implement for [Obsidian-Tasks-Timeline](https://github.com/702573N/Obsidian-Tasks-Timeline).

In this repo, the `view.js` which originally handles:
1. task item parsing
2. rendering
3. filtering according to user options

is re-implemented with typescript and React. The functions are splited in multiple modularized scripts.

The purposes are:

1. Making the origin view designed by [@702573N](https://github.com/702573N) an interface, so that task item from any sources (e.g. normal task items, [the Tasks plugin](https://github.com/obsidian-tasks-group/obsidian-tasks), dataview format tasks) could be rendered and managed with this view.
2. Make the view a component, so that it can be used in other projects.


# LICENSE

MIT.
