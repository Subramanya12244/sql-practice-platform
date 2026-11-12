/**
 * Contextual Help for every visual learning module, shown by <VisualHelp id=… /> (components/visual/VisualHelp.tsx), which is
 * the single help mechanism for the visual tools. (The "DataForge Guide" pages are concept articles, not in-app help.)
 *
 * Every entry says what the tool does, how to use it, what its own controls do, how to read what it shows (naming which parts
 * are Executed, Parsed, Plan, Estimated, Conceptual or Simulated), common mistakes, one worked example and, where useful, a
 * short guided walkthrough. The shared playback controls are added automatically from PLAYBACK_CONTROLS, so entries describe
 * only the controls that belong to the tool. Lists must not repeat a line (the component uses the text as its React key).
 */
export type HelpId = "sql" | "python" | "data" | "api" | "etl" | "charts" | "tree" | "graph" | "excel" | "linux" | "git" | "stats" | "business" | "interview";

export interface HelpEntry {
  title: string;
  /** What the visualizer does, in one or two sentences. */
  what: string;
  /** How to use it, as steps. */
  how: string[];
  /** Controls specific to this tool (the shared playback controls are described once, in PLAYBACK_CONTROLS). */
  controls?: { name: string; does: string }[];
  /** What the displayed information means, including which parts are real, modelled or simulated. */
  reading: string[];
  mistakes: string[];
  example: string;
  /** Optional guided walkthrough: one card per step. */
  walkthrough?: { title: string; body: string }[];
}

export const PLAYBACK_CONTROLS: { name: string; does: string }[] = [
  { name: "Play / Pause", does: "Advances one step every moment automatically; pauses where you are." },
  { name: "Next step / Previous step", does: "Moves one step forward or back and pauses." },
  { name: "Restart", does: "Returns to the first step." },
  { name: "Speed", does: "Sets how long each step stays on screen (0.5x to 4x)." },
  { name: "Timeline", does: "Drag to jump to any step." },
  { name: "Keyboard", does: "With the controls focused: Space plays or pauses, arrows step, Home restarts, End jumps to the last step." },
];

export const HELP_IDS: HelpId[] = ["sql", "python", "data", "api", "etl", "charts", "tree", "graph", "excel", "linux", "git", "stats", "business", "interview"];

export const HELP: Record<HelpId, HelpEntry> = {
  sql: {
    title: "SQL Query Cinema",
    what: "Runs your SELECT on the Northwind sample database in your browser and replays it as the logical stages SQL follows, with the rows each stage keeps and removes. It also shows the query's parsed structure and PostgreSQL's execution plan, and can compare two queries.",
    how: [
      "Pick an example button or type a query in the editor.",
      "Press Visualize. Every query is rolled back, so nothing in the sample database changes.",
      "Open the Logical steps tab and press Play, or step with Next step. Each stage lists its rows and how many were kept and removed.",
      "Watch the row animation: rows enter a stage and either carry on to the next one or leave. Use the Animations switch to reduce or turn off the movement.",
      "Open Flow diagram, Relationships, Structure and Execution plan to see the same query from other angles.",
      "Scroll to Compare two queries to test a rewrite against your original.",
    ],
    controls: [
      { name: "Example buttons", does: "Load a ready-made query: JOIN with GROUP BY and HAVING, LEFT JOIN with unmatched rows, a window function, DISTINCT, a CTE, UNION, CASE with NULL, or a subquery." },
      { name: "Visualize", does: "Runs the query and builds the stages. Editing the query does nothing until you press it." },
      { name: "Logical steps", does: "The stages in SQL's processing order: FROM and JOIN, WHERE, GROUP BY, HAVING, window functions, SELECT, DISTINCT, ORDER BY and LIMIT. Only the clauses your query uses appear." },
      { name: "Flow diagram", does: "A box-and-arrow picture of the query. Click a box to highlight its clause in the SQL text." },
      { name: "Relationships", does: "The tables the query reads, how each join connects them, and the primary and foreign key columns." },
      { name: "Structure", does: "How the query is built: tables, joins, CTEs and set operations. Queries with UNION, INTERSECT or EXCEPT open here, with each branch and how the results are combined." },
      { name: "Execution plan", does: "The plan PostgreSQL chose, as a tree. Click a node for a plain-language explanation. The button Run EXPLAIN ANALYZE runs the query again and adds actual timings." },
      { name: "Animations switch", does: "Follow system, Reduce motion or Full motion. With reduced motion the row movement is replaced by an instant change and the numbers still update." },
      { name: "Compare two queries", does: "Runs your query and an alternative, then reports whether the output is the same, how the logical steps differ, the plan cost and the median run time." },
    ],
    reading: [
      "Rows in each stage are Executed: they come from really running your query, and the kept and removed counts are exact. A stage shows at most 20 sample rows; the count above them is the true total.",
      "The Logical steps are the order SQL conceptually applies clauses (Conceptual). A database may physically do things in another order; the plan shows that.",
      "Flow diagram, Relationships and Structure are Parsed from your query text. If the parser cannot read a feature, the page says so and still shows what it can.",
      "Execution plan is a Plan, and its costs and row counts are Estimated by PostgreSQL's planner. Only the timings after Run EXPLAIN ANALYZE are Executed, and they depend on this browser.",
      "For a UNION, INTERSECT or EXCEPT, the picture shows both inputs and the combined result. UNION removes duplicates, UNION ALL keeps them, INTERSECT keeps rows found in both inputs and EXCEPT keeps rows found only in the first.",
      "In Compare, a lower plan cost is an estimate and the median time is a measurement in your browser, so small differences are noise.",
    ],
    mistakes: [
      "Expecting SQL to run top to bottom. The text starts with SELECT but the work starts at FROM. The stages show the real logical order.",
      "Reading the animation as the database's physical work. It teaches the logical order; only the Execution plan describes how PostgreSQL really runs it.",
      "Filtering an aggregate in WHERE. WHERE runs before GROUP BY, so use HAVING for conditions on COUNT, SUM and similar.",
      "Writing a query for a different dataset. The Cinema uses Northwind; tables from another schema will fail.",
      "Trusting a small time difference in Compare. Run it twice and trust only a clear gap.",
    ],
    example: "Load JOIN + GROUP BY + HAVING and press Visualize. Step to WHERE and see freight values of 10 or less removed. Step to GROUP BY and see the rows collapse into one per country. Step to HAVING and see countries with fewer than 3 orders removed. Then open Execution plan to see how PostgreSQL joined the two tables.",
    walkthrough: [
      { title: "Run a query", body: "Choose JOIN + GROUP BY + HAVING and press Visualize. The Logical steps tab lists one stage per clause." },
      { title: "Follow the rows", body: "Press Next step. At each stage compare the count in and the count out, and open Removed at this stage to see which rows left and why." },
      { title: "Control the motion", body: "Use the Animations switch. Reduce motion swaps the movement for an instant change; the stage numbers are the same." },
      { title: "Try a set operation", body: "Load UNION (set operator). The Structure tab shows both branches and how their results combine." },
      { title: "Read the plan", body: "Open Execution plan, click a node for its plain-language meaning, then press Run EXPLAIN ANALYZE to add real timings." },
      { title: "Compare a rewrite", body: "In Compare two queries paste a rewrite under Alternative and press Compare. Check that the output is equal before you look at cost." },
    ],
  },

  python: {
    title: "Python Code Time Machine",
    what: "Runs your Python once in your browser, records every line that executes, then lets you replay the run step by step with the variables, the call stack and the output so far.",
    how: [
      "Pick an example or type your own code in the editor.",
      "Press Explain visually. The code runs once and the recording appears; if it fails, you see the error and the state just before it.",
      "Press Play or step with Next step. The highlighted line is the one about to run or just run.",
      "Watch Variables for what changed, and the Call stack for which function you are in.",
      "Open Memory model to see names pointing at objects, which explains aliasing and copies.",
      "Change the code and run again to test your prediction.",
    ],
    controls: [
      { name: "Example buttons", does: "Load code for a loop, list aliasing, a dictionary, recursion, a generator, an exception, a linked list, or a stack and queue." },
      { name: "Explain visually", does: "Runs the code and records the trace. It does not change your lesson progress or grading." },
      { name: "Variables tab", does: "Every variable in the current frame, with the ones that just changed marked." },
      { name: "Memory model tab", does: "Names on one side and objects on the other, with arrows. Two names pointing at one object show aliasing." },
      { name: "Call stack", does: "The functions that are active, innermost last. Recursion shows one frame per call." },
      { name: "Output so far", does: "What print() has written up to the current step." },
      { name: "Cost of this run", does: "Per-line run counts and growth notes for loops, nested loops and recursion." },
    ],
    reading: [
      "The trace is Executed: the line order, the variable values, the call stack and the output come from a real run of your code in your browser.",
      "The Memory model is a Conceptual model. It draws names, objects and references to teach how Python behaves; it is not CPython's real memory layout, and the addresses are not real.",
      "Growth notes in Cost of this run are Estimated from the code's shape (nested loops, recursion). They describe step counts, not timings.",
      "Long loops are sampled. The trace keeps the first iterations, a summary of the loop, checkpoints along the way and the last iterations. A gap marker shows where iterations were left out, and says how many. The program still ran to the end, so the final values and output are real.",
      "Large values are trimmed for display (long lists show their first items, big tables show a window).",
      "A step that raises an exception shows the exception type and the state before it, which is where to look for the cause.",
    ],
    mistakes: [
      "Reading a gap marker as missing code. The skipped iterations did run; the trace only does not store each one.",
      "Treating the memory diagram as real addresses. It teaches references, nothing more.",
      "Tracing a function that is never called. Add a call such as print(total([1, 2])) so the function body actually runs.",
      "Expecting input() to wait for you. The run is not interactive, so supply the values in the code.",
      "Assuming packages beyond the browser's Python are available. Code that needs other packages cannot be traced.",
    ],
    example: "Load List aliasing and run it. At b = a, open Memory model: a and b both point at one list. After b.append(3), Variables shows a changed even though only b was touched. At c = a.copy(), c points at a new list, so c.append(4) leaves a alone.",
    walkthrough: [
      { title: "Run the trace", body: "Pick Loop and total and press Explain visually. Step with Next step and watch total change on the line that adds to it." },
      { title: "Read the call stack", body: "Load Recursion. Each call adds a frame to the Call stack and each return removes one, with the returned value shown." },
      { title: "See aliasing", body: "Load List aliasing and open Memory model. Find the step where two names point at the same object." },
      { title: "Meet an error", body: "Load Exception. The trace stops at the failing line and shows the exception type with the variables just before it." },
      { title: "Check a long loop", body: "Write a loop that runs hundreds of times. The trace shows the first iterations, a summary, checkpoints, the last iterations and gap markers; the printed result is still exact." },
    ],
  },

  data: {
    title: "Pandas and NumPy Studio",
    what: "Runs your pandas or NumPy code and shows the real table or array before and after each step, with the cells that changed, the shape, the dtypes and the missing values.",
    how: [
      "Pick an example (filter, groupby, merge, missing values, pivot, broadcasting, masks) or write your own code.",
      "Press Explain visually to run it once and record every step.",
      "Step through. On each step that produces a table or array, the before and after grids sit side by side.",
      "Read the sentence under the grids: it says what changed, such as rows removed, a new column or a changed dtype.",
      "Change one line, run again and compare.",
    ],
    controls: [
      { name: "Example buttons", does: "Load filter and sort, groupby and aggregate, merge, missing values and types, pivot and melt, duplicates and concat, NumPy broadcasting, or masks, slicing and aggregation." },
      { name: "Tables and arrays tab", does: "The before and after grids for the variable the current line produced." },
      { name: "Variables tab", does: "All variables at this step, the same view as the Python Code Time Machine." },
    ],
    reading: [
      "The tables and arrays are Executed: they come from really running your pandas or NumPy code in your browser.",
      "Highlighted cells are cells whose value changed between before and after. A new row or column is marked as new.",
      "Shape is rows by columns for a table, or the size of each axis for an array. dtype is the stored type, which decides what an operation does.",
      "Large tables are trimmed to a window of rows and columns for display. Counts such as shape and missing values still describe the full data.",
      "The sentence under the grids is written by rules from the real before and after, not by an AI service.",
    ],
    mistakes: [
      "Forgetting that most pandas methods return a new table. Calling df.dropna() without assigning the result changes nothing.",
      "Comparing a NumPy axis to a pandas axis without checking the shape. axis=0 runs down the rows, axis=1 across the columns.",
      "Reading NaN as zero. Missing values are skipped by most aggregations, not counted as 0.",
      "Merging on columns with different dtypes. A text '1' and an integer 1 do not match.",
      "Expecting the studio to open your own files. It runs code against data you create in the code.",
    ],
    example: "Load Merge and run it. users has 3 rows and orders has 3. With how='left', Chen keeps one order and Ben has none, so Ben's amount shows NaN. Change how='left' to 'inner' and run again to see Ben disappear.",
    walkthrough: [
      { title: "Filter a table", body: "Run Filter and sort. Step to the filter line and see which rows left." },
      { title: "Group and aggregate", body: "Run GroupBy and aggregate. Many rows become one row per key; the grid shows the new index." },
      { title: "Watch broadcasting", body: "Run NumPy broadcasting. The smaller array is stretched across the larger one, and the result grid shows every sum." },
      { title: "Fix missing values", body: "Run Missing values and types. See fillna replace gaps and to_numeric turn bad text into NaN." },
    ],
  },

  api: {
    title: "API Request Studio",
    what: "Follows one request from the URL and headers to the response, the status code, the parsed JSON, retries, backoff and pagination, against a safe built-in mock server on a virtual clock.",
    how: [
      "Choose a scenario tab such as 200 OK, 401 Unauthorized, 429 Too Many Requests, 500 and exponential backoff, Timeout or a pagination scenario.",
      "Change the client settings: credentials, retries, backoff, timeout, page size and the two checkboxes.",
      "Press Play or step through the frames. Each frame shows the request on one side and the response on the other.",
      "Read the result line under the player: the outcome, the number of requests and the virtual time.",
      "Change one setting and watch how the outcome changes.",
    ],
    controls: [
      { name: "Scenario tabs", does: "Pick which situation to replay: success, 201 created, 400, 401, 403, 404, 429, 500 with retries, timeout, offset pagination or cursor pagination." },
      { name: "Credentials", does: "Valid, missing, expired or read-only token. It changes which status the server returns." },
      { name: "Max retries and Backoff base", does: "How many times the client retries and how long it waits before the first retry. The schedule under the settings shows the growing delays." },
      { name: "Timeout", does: "How long the client waits, in virtual milliseconds, before it gives up." },
      { name: "Page size", does: "How many records come back per page in the pagination scenarios." },
      { name: "Honour Retry-After", does: "When ticked, the client waits as long as the server's Retry-After header says before trying again." },
      { name: "Send Idempotency-Key", does: "When ticked, a repeated POST is recognised as the same request and does not create a second record." },
    ],
    reading: [
      "Everything here is Simulated. A deterministic mock server answers; no real network request is made and you cannot enter a URL.",
      "The clock is virtual. Times in milliseconds are what the scenario models, not real waiting, so the page never actually pauses.",
      "A status code in the 4xx range means the request was at fault, so retrying the same request cannot help. 5xx and timeouts may be temporary, so a retry can help.",
      "Backoff delays grow each retry (base, then double, and so on) so a struggling server is not hit again at once.",
      "Idempotent means repeating the request has the same effect as sending it once. GET and PUT are; a plain POST is not unless you send a key.",
    ],
    mistakes: [
      "Retrying a 400, 401 or 403 over and over. Fix the request or the credentials first.",
      "Retrying a POST with no idempotency key and creating duplicate records.",
      "Setting retries high with no backoff, which hammers a server that is already failing.",
      "Ignoring Retry-After on a 429 and being blocked for longer.",
      "Treating the simulation as a model of a particular service. Real services differ in limits, headers and error bodies.",
    ],
    example: "Choose 500 and exponential backoff with max retries 3 and base 200 ms. The mock server fails the first two requests, so the frames show a wait of 200 ms, a second failure, a wait of 400 ms and then success on the third request. Set max retries to 1 and the client gives up after the second failure.",
    walkthrough: [
      { title: "A successful read", body: "Open 200 OK and step through: request line, headers, response, then the parsed JSON." },
      { title: "A rate limit", body: "Open 429. Tick and untick Honour Retry-After and compare the wait between attempts." },
      { title: "Safe retries", body: "Open 201 Created and idempotency. Send the same POST twice with the key off, then on." },
      { title: "Page through results", body: "Open Offset pagination, then Cursor pagination, and compare how each knows when to stop." },
    ],
  },

  etl: {
    title: "ETL Pipeline Playback",
    what: "Plays a small pipeline from source through extract, validate, transform and load to the target, showing row counts, rejects, retries, checkpoints and what happens when a step fails.",
    how: [
      "Open the Pipeline run tab and choose full or incremental load, upsert or append, and a failure to inject.",
      "Tick Deduplicate, Quarantine bad rows or Dead-letter queue as you wish.",
      "Press Play or step through. Each stage shows the rows that went in, the rows that came out and the rows rejected.",
      "Read the run result line: status, retries, quarantined and dead-lettered rows, the next checkpoint and virtual duration.",
      "Visit the other tabs for slowly changing dimensions, change data capture and task dependencies.",
    ],
    controls: [
      { name: "Load mode and Watermark", does: "Full load reads everything. Incremental reads only rows newer than the watermark date and moves the checkpoint forward." },
      { name: "Load style", does: "Upsert updates a row that already exists, so a re-run is safe. Append adds rows again, so a re-run duplicates them." },
      { name: "Inject a failure", does: "Makes extract fail twice or always, crashes the transform on row 6, or makes the load fail once, so you can see retries and recovery." },
      { name: "Max retries", does: "How many times a failed stage is tried again before the run is marked failed." },
      { name: "Deduplicate, Quarantine, Dead-letter", does: "Drop repeated keys, set invalid rows aside for review, and park rows that keep failing." },
      { name: "Topic tabs", does: "Pipeline run, Slowly changing dimension (history kept with effective dates), Change data capture (replaying a change feed) and Dependencies (a task fails and downstream tasks wait)." },
    ],
    reading: [
      "All of it is Simulated, on a fixed sample dataset and a virtual clock. No real database, file or scheduler is involved.",
      "The counts add up: rows in equal rows loaded plus rejected plus skipped. If they do not, something was lost, and that is what reconciliation looks for.",
      "The checkpoint is where the next incremental run starts. It only moves forward after a successful load.",
      "Quarantined rows are bad rows kept for repair. Dead-lettered rows are ones that failed after every retry.",
      "A run that stops partway shows exactly which stage failed and what the target holds as a result. With Quarantine ticked a bad row is set aside and the run continues; with it off the first bad row fails the run.",
    ],
    mistakes: [
      "Using append for a job that may be re-run. Use upsert, or the same rows load twice.",
      "Moving the watermark before the load has succeeded, which silently skips rows after a failure.",
      "Dropping bad rows with no quarantine, so nobody learns what was wrong.",
      "Setting unlimited retries on a failure that will never succeed.",
      "Assuming a clean first run proves the pipeline is correct. Inject failures and run it twice.",
    ],
    example: "Choose Incremental, watermark 2026-03-02, Upsert, and no failure. Only rows after that date are extracted and the checkpoint moves up. Now choose Append, run the same load twice from the start and compare the target row count to the upsert run.",
    walkthrough: [
      { title: "Run a clean pipeline", body: "Leave the failure on None and step from SOURCE to TARGET, noting the row count at each stage." },
      { title: "Break extract", body: "Choose Extract fails twice with Max retries 3. The run recovers after two retries." },
      { title: "Make it fail for good", body: "Choose Extract always fails. The run ends failed and the checkpoint does not move." },
      { title: "Crash in the transform", body: "Choose Transform crashes on row 6. The run fails, nothing is loaded and the watermark does not move, so the next run re-reads the rows." },
    ],
  },

  charts: {
    title: "Data Visualization Explorer",
    what: "Lets you change the chart type, dimension, measure, aggregation and filters on a fixed sample sales dataset and watch the chart change, with advice on when a chart fits and when it misleads.",
    how: [
      "Choose a chart type: bar, line, time series, scatter, histogram, box plot, pie or heatmap.",
      "Choose what to group by (the dimension) and what to measure.",
      "Choose an aggregation such as sum, average, count, minimum or maximum, where it applies.",
      "Filter by region, category or channel with the checkboxes.",
      "Read the advice about the chart, then look at the table of numbers behind it.",
    ],
    controls: [
      { name: "Chart type", does: "Switches the drawing. The other controls adapt: scatter needs a second measure, a heatmap a second dimension, a histogram a bin count." },
      { name: "Dimension and Measure", does: "Dimension is what you group by (month, region, category, channel). Measure is the number you plot (revenue, units, price)." },
      { name: "Aggregation", does: "How the rows in each group are combined into one value." },
      { name: "Bins", does: "For a histogram, how many equal-width ranges the values are split into." },
      { name: "Zero baseline", does: "For bar and line charts, forces the vertical axis to start at zero. Turn it off to see how a truncated axis exaggerates differences." },
      { name: "Filters", does: "Keep only the chosen regions, categories or channels." },
    ],
    reading: [
      "The data is Simulated: a fixed sample of 144 sales rows generated by a formula. It is not your data and it does not change between visits.",
      "The numbers table under the chart is the exact data that was drawn, computed from the fixture with your settings. The chart and the table always agree.",
      "The advice (when a chart fits, when it misleads) is a Conceptual guide written from fixed rules about chart types, not generated for each picture.",
      "Averages hide spread. The box plot shows the median, the quartiles and the outliers, so use it when spread matters.",
      "A pie with many slices, or a bar chart with a truncated axis, can mislead even though every number is correct.",
    ],
    mistakes: [
      "Using a pie for many categories or for values that do not make a whole.",
      "Cutting the axis off from zero on a bar chart, which makes small gaps look large.",
      "Summing a price, which has no meaning. Use an average or a median for rates and prices.",
      "Reading a correlation in a scatter as proof of cause.",
      "Picking too few or too many histogram bins and seeing a shape that is not really there.",
    ],
    example: "Choose Bar, dimension region, measure revenue, aggregation sum. Tick Zero baseline off and see the gaps between regions grow. Tick it on again. Then switch to Box plot with measure price to see the spread that an average would hide.",
    walkthrough: [
      { title: "Compare groups", body: "Start with a bar chart of revenue by region and read the numbers table." },
      { title: "See the axis effect", body: "Turn the zero baseline off and on and compare how large the differences look." },
      { title: "Look at a distribution", body: "Switch to Histogram and change the bins from 3 to 20." },
      { title: "Check a relationship", body: "Switch to Scatter with units and revenue and read what the advice says about causes." },
    ],
  },

  tree: {
    title: "Tree Explorer",
    what: "Builds binary trees and binary search trees and shows insertion, search, deletion and traversals one step at a time, with the call stack or queue, the height and depth, and what a degenerate tree looks like.",
    how: [
      "Pick a starting example from the presets, or start from an empty tree and type values to insert.",
      "Choose an operation: insert, search, delete, or a traversal.",
      "Press Play or step. The current node is highlighted and the step text says which comparison is being made.",
      "Watch the call stack (for the recursive traversals) or the queue (for level order) beside the tree.",
      "Read the height and depth values, then try inserting values in sorted order to see a degenerate tree.",
    ],
    controls: [
      { name: "Presets", does: "Start from a prepared tree, such as a balanced search tree, or a lopsided one, so you can compare them." },
      { name: "Insert, Search and Delete", does: "Run the operation for the value you type. Delete covers a leaf, a node with one child and a node with two children." },
      { name: "Traversal order and method", does: "Choose in-order, pre-order, post-order or level order, and run it recursively (call stack) or iteratively (explicit stack, or a queue for level order), then press Run traversal. The output builds up as you step." },
      { name: "Height, depth and balance", does: "Shows the height of the tree and the depth of each node, and whether the tree is balanced. Why balance matters compares your tree with a balanced one of the same size." },
      { name: "Rebuild as BST, Reset to preset, Custom tree", does: "Rebuild turns the current values into a search tree, Reset restores the preset, and Custom tree loads a tree you describe as text." },
      { name: "Call stack or queue panel", does: "The pending calls for the depth-first traversals, or the waiting nodes for level order." },
    ],
    reading: [
      "The steps are Executed: the algorithm itself really runs in the page on the tree you see, and each step is recorded from that run. It is not your own code. The pseudo-code panel highlights the line that is running.",
      "In a binary search tree, smaller values go left and larger values go right. Search follows one path, so its cost is about the height of the tree.",
      "In-order traversal of a search tree visits values in sorted order. That is a quick check that the tree is valid.",
      "Height is the number of edges on the longest path down from the root. Depth of a node is the number of edges from the root to that node.",
      "A degenerate tree (values inserted in sorted order) is a chain: its height equals its size, so search is no faster than scanning a list.",
    ],
    mistakes: [
      "Expecting a search tree to stay balanced on its own. This one does not rebalance.",
      "Mixing up the traversal orders. Pre-order visits the node first, in-order between its children, post-order last.",
      "Forgetting the two-children delete case, where the node is replaced by its in-order successor.",
      "Counting nodes instead of edges for height. A single node has height 0 here.",
      "Reading a lopsided tree as a bug. It is the correct result for that insertion order.",
    ],
    example: "Insert 50, 30, 70, 20, 40 into an empty tree, then run an in-order traversal: it visits 20, 30, 40, 50, 70. Now start over and insert 10, 20, 30, 40, 50: every value goes right, the height is 4, and the tree is a chain.",
    walkthrough: [
      { title: "Build a tree", body: "Insert 50, 30, 70, 20, 40 and watch each new value compare its way down to its place." },
      { title: "Search for a value", body: "Search for 40, then for 45, which is not there. Count the comparisons." },
      { title: "Walk it", body: "Run in-order and then level order. Compare the call stack with the queue." },
      { title: "Make it degenerate", body: "Insert values in sorted order and see the height grow to the number of nodes minus one." },
    ],
  },

  graph: {
    title: "Graph Explorer",
    what: "Runs graph algorithms step by step on a small graph: breadth-first and depth-first search (with an explicit stack or recursive), Dijkstra and Bellman-Ford shortest paths, directed and undirected cycle detection, connected components, strongly connected components (Tarjan) and Kahn topological sort, with the queue or stack and the visited state on screen.",
    how: [
      "Choose a preset graph, or edit the nodes and edges.",
      "Choose an algorithm and a start node.",
      "Press Play or step. The current node and the edges being examined are highlighted.",
      "Watch the queue (BFS) or stack (DFS) and the visited set change, and for shortest paths the distance table.",
      "Read the result when the run ends: an order, a distance, a cycle, groups or a sort.",
    ],
    controls: [
      { name: "Presets", does: "Prepared graphs: tree, cycle, disconnected, roads (weighted), dag (for ordering), negative (a negative weight), negative-cycle and scc. Custom (edited) appears when you change the edge list." },
      { name: "Edges, one per line", does: "Edit the graph as text, one edge per line. An edge list that is too big or malformed is reported, not run." },
      { name: "Algorithm", does: "BFS, DFS, Dijkstra, Bellman-Ford, cycle detection, connected components, strongly connected components or topological sort." },
      { name: "Start node", does: "Where the search begins. Shortest-path results are distances from this node." },
      { name: "Queue or stack panel", does: "BFS takes the oldest waiting node (a queue). DFS takes the newest (a stack)." },
      { name: "Visited and distance state", does: "Which nodes are done, and for the weighted algorithms the best known distance to each node." },
    ],
    reading: [
      "The steps are Executed: the algorithm really runs in the page on your graph and each step is recorded from that run. It does not trace code you wrote. The pseudo-code panel highlights the running line. Graphs are limited in size, and nothing leaves your browser.",
      "BFS visits nodes in rings of distance from the start, so it finds the fewest edges. DFS dives as far as it can before backing up.",
      "Dijkstra needs non-negative weights. Bellman-Ford allows negative weights and can detect a negative cycle.",
      "Topological sort (Kahn) only exists for a directed graph with no cycle. It lists every node after all nodes it depends on, which is how a scheduler orders tasks. Strongly connected components group nodes that can all reach each other.",
      "A cycle in a directed graph means some task would wait for itself, so no valid order exists.",
    ],
    mistakes: [
      "Using Dijkstra on a graph with negative weights. It can give a wrong answer; use Bellman-Ford.",
      "Expecting one single answer for BFS or DFS order. It depends on the order neighbours are listed.",
      "Reading the DFS path to a node as the shortest path. Only BFS (unweighted) and the weighted algorithms promise shortest.",
      "Forgetting to mark a node visited when it is added, which makes it get added twice.",
      "Looking for a topological order of a graph that has a cycle. None exists.",
    ],
    example: "Load the dag preset and run topological sort. Nodes appear only after everything they depend on. Add an edge that closes a loop and run again: the algorithm stops and reports a cycle.",
    walkthrough: [
      { title: "Search by rings", body: "Run BFS from a start node and watch the queue; nodes leave in the order they arrived." },
      { title: "Search by depth", body: "Run DFS on the same graph and compare the visit order and the stack." },
      { title: "Find a shortest path", body: "Run Dijkstra on the weighted graph and watch the distance table improve." },
      { title: "Order tasks", body: "Run topological sort on the directed acyclic graph, then introduce a cycle." },
    ],
  },

  excel: {
    title: "Excel Lab",
    what: "A small interactive spreadsheet that evaluates formulas step by step. It covers lookups, a pivot simulator, conditional formatting and data cleaning. It is a simulated subset of Excel, not Excel itself.",
    how: [
      "Pick a preset such as a lookup, a pivot or a cleaning task.",
      "Click a cell to see its formula, then step through how the formula is evaluated, from the references to the final value.",
      "Change a value or a formula and see the dependent cells recalculate.",
      "In the pivot simulator choose rows, columns and values and see the summary build.",
      "Try conditional formatting and the cleaning steps and compare the sheet before and after.",
    ],
    controls: [
      { name: "Presets", does: "Start from a prepared sheet for formulas, lookups, a pivot, conditional formatting or cleaning." },
      { name: "Formula bar", does: "Shows and edits the selected cell's formula. Evaluation steps appear beside it." },
      { name: "Pivot fields", does: "Choose which column groups the rows, which groups the columns and which value is summed or counted." },
      { name: "Format rules", does: "Define a highlight rule, for example a value above a limit, and see which cells it marks." },
      { name: "Cleaning steps", does: "Steps such as Remove duplicates and Text to columns, applied one at a time and listed under Applied steps." },
      { name: "What this lab does not support", does: "A list of Excel features and functions the lab leaves out. Read it before you trust a result against real Excel." },
    ],
    reading: [
      "This is Simulated. The lab has its own formula engine for a subset of Excel functions. A function it does not know is reported, not guessed.",
      "Evaluation steps show a formula resolved piece by piece: first the cell references, then the inner function, then the outer one.",
      "A lookup shows which row matched and why. An exact match needs the key to be identical, and an approximate match needs a sorted list.",
      "A pivot table groups rows by a field and summarises a value. The cells are totals of the rows that share that group.",
      "Error values such as #N/A, #DIV/0! and #REF! are shown the way Excel would show them, with the reason beside them.",
    ],
    mistakes: [
      "Copying a formula and finding a reference moved. Use $ to lock a row or column when it should stay fixed.",
      "Using an approximate match lookup on unsorted data and getting a wrong answer with no error.",
      "Typing numbers as text, so they do not add up. A leading apostrophe or a stray space is a common cause.",
      "Assuming the lab supports every Excel function, or Power Query and macros. It does not.",
      "Hard-coding a number inside a formula instead of pointing to a cell.",
    ],
    example: "Open the lookup preset. Select the cell that returns a price for a product code and step through its XLOOKUP: the code is read from its cell, found in the list, and the price in the same row is returned. Change the code to one that does not exist and watch #N/A appear.",
    walkthrough: [
      { title: "Evaluate a formula", body: "Select a cell with an IF formula and step through the comparison and the chosen result." },
      { title: "Look something up", body: "Run the lookup preset and compare exact and approximate match." },
      { title: "Summarise with a pivot", body: "Open the pivot preset, put region in rows and revenue in values, and check a total by hand." },
      { title: "Clean a column", body: "Apply the cleaning steps one by one and watch stray spaces and mixed case disappear." },
    ],
  },

  linux: {
    title: "Linux Terminal Lab",
    what: "A simulated terminal over a safe virtual file system. You type real commands and see their output, including pipes, redirection, permissions and processes, without touching your computer.",
    how: [
      "Pick a preset task or just start typing at the prompt.",
      "Navigate with pwd, ls and cd, and read files with cat, head and tail.",
      "Combine commands with a pipe, for example sort | uniq -c, and send output to a file with > or >>.",
      "Change permissions with chmod and look at them with ls -l.",
      "List processes and stop one, then compare what you see to the explanation beside the terminal.",
    ],
    controls: [
      { name: "Presets", does: "Prepared tasks, such as finding text in log files, counting values with a pipe or fixing a file's permissions." },
      { name: "Terminal prompt", does: "Type a command and press Enter. Up and down arrows recall earlier commands." },
      { name: "File tree", does: "The virtual folders and files, which update as you create, move or delete them." },
      { name: "Reset", does: "Restores the sample files, so a mistake costs nothing." },
    ],
    reading: [
      "Everything is Simulated. A built-in interpreter handles a subset of common commands on a virtual file system held in the page. Nothing runs on your computer and no real file is read or changed.",
      "A command it does not support says so. The real shell has many more commands and options.",
      "In a pipe, the output of the left command becomes the input of the right one. In redirection, > replaces a file and >> adds to it.",
      "ls -l shows permissions as three groups of read, write and execute: owner, group, others. chmod changes them, and the number form adds read 4, write 2, execute 1.",
      "Processes and their numbers are sample data, not your real processes.",
    ],
    mistakes: [
      "Using > when you meant >>. It silently replaces the file's contents.",
      "Running a destructive command in a real shell because it worked here. The lab is safe; your computer is not.",
      "Forgetting that a script file needs execute permission before it can run directly.",
      "Quoting wrongly, so a space splits a filename into two arguments.",
      "Expecting this lab's output to match your machine's exactly. Commands and versions differ.",
    ],
    example: "Run sort names.txt | uniq -c | sort -rn > counts.txt, then cat counts.txt. The first command orders the names, uniq -c counts repeats, sort -rn puts the biggest count first, and > saves the result to a new file.",
    walkthrough: [
      { title: "Look around", body: "Use pwd and ls -l, then cd into a folder and cat a file." },
      { title: "Chain commands", body: "Pipe the output of grep into sort and wc -l and explain each stage." },
      { title: "Redirect output", body: "Save the result with > then add a line with >> and check the file." },
      { title: "Fix a permission", body: "Use ls -l to find a file you cannot run, chmod it and try again." },
    ],
  },

  git: {
    title: "Git Lab",
    what: "Shows commits, branches, merges and rebases as a growing graph, along with the working tree, staging area and repository, and walks you through resolving a merge conflict. It is a simulation, not a real Git.",
    how: [
      "Pick a preset such as two branches, a merge or a conflict.",
      "Run commands like git add, git commit, git branch, git switch, git merge and git rebase.",
      "Watch the commit graph change and the three areas (working tree, staging area, repository) update.",
      "Compare a merge with a rebase on the same starting point.",
      "In a conflict preset, edit the conflicted file, stage it and finish the merge.",
    ],
    controls: [
      { name: "Presets", does: "Prepared situations: linear history, a feature branch, a fast-forward merge, a diverged merge, a rebase and a conflict." },
      { name: "Command box", does: "Type a Git command from the supported set and see the graph and the three areas respond." },
      { name: "Commit graph", does: "Each circle is a commit; branch names and HEAD are labels that point at commits." },
      { name: "Three areas panel", does: "Where each file sits: the working tree, the staging area or the repository." },
      { name: "Conflict editor", does: "Shows the conflict markers and lets you choose a resolution before you continue." },
    ],
    reading: [
      "This is Simulated. Its own model of commits, branches and the three areas answers a supported subset of commands. No repository or file on your computer is used.",
      "A branch is only a movable label on a commit. Creating one copies nothing.",
      "A fast-forward merge only moves a label. A merge of diverged branches creates a new commit with two parents.",
      "A rebase replays your commits on a new base, so they become new commits with new ids and the history is a straight line.",
      "A conflict means both sides changed the same lines. Git cannot choose, so it marks the file and waits for you.",
    ],
    mistakes: [
      "Rebasing commits that others already have. It rewrites history, so teammates then have a different version.",
      "Forgetting git add. A change only goes into the next commit if it is staged.",
      "Committing on the wrong branch. Check which branch HEAD is on before you commit.",
      "Leaving conflict markers in the file and committing them.",
      "Assuming every Git command or option exists in the lab. Only a subset is simulated.",
    ],
    example: "Load the diverged branches preset. Run git merge feature from main and see a merge commit with two parents. Reset the preset, run git rebase main from feature instead, and see the feature commits copied on top of main as a straight line.",
    walkthrough: [
      { title: "Make a commit", body: "Edit a file, run git add, then git commit and watch the file move through the three areas." },
      { title: "Branch and merge", body: "Create a branch, commit on it, and merge it back." },
      { title: "Compare with a rebase", body: "Repeat the same history and use rebase instead; compare the two graphs." },
      { title: "Resolve a conflict", body: "Open the conflict preset, pick the right lines, stage the file and finish the merge." },
    ],
  },

  stats: {
    title: "Statistics Lab",
    what: "Lets you move data and settings and watch distributions, spread, probability, sampling, the central limit theorem, confidence intervals, hypothesis tests and regression respond. It uses seeded simulations, so results are repeatable.",
    how: [
      "Pick a topic tab or a preset, such as normal distribution, central limit theorem or t-test.",
      "Change the controls: sample size, mean, spread, number of samples or the data points themselves.",
      "Read the numbers that update beside the chart: mean, median, standard deviation, interval or p-value.",
      "Press the resample or step control to draw another sample and see how results vary.",
      "Check the plain-language reading under the chart before you decide what it means.",
    ],
    controls: [
      { name: "Presets", does: "Start from a prepared example: distributions, descriptive statistics, probability, sampling, confidence intervals, tests (z, t, Welch, chi-square) or correlation and regression." },
      { name: "Parameter sliders", does: "Move the mean, spread, sample size, confidence level or similar and see the chart and numbers recompute." },
      { name: "Data points", does: "Where offered, add, move or remove points, for example to see an outlier pull a mean or a regression line." },
      { name: "Random seed and New seed", does: "The seed fixes the random numbers so a result can be repeated. New seed draws a fresh set." },
      { name: "Add an outlier point and Reset data", does: "In the correlation and regression view, add one extreme point to see its pull on the line, then restore the data." },
    ],
    reading: [
      "Numbers computed from the data on screen are Executed: the mean, standard deviation, interval, test statistic and p-value come from the standard formulas applied to that data. Random draws are Simulated from a seed, so a given seed always gives the same data, but the data is not from a real survey or experiment.",
      "Results are repeatable: the same seed and settings always give the same numbers.",
      "A confidence interval at 95% means that if you repeated the sampling many times, about 95 of 100 such intervals would contain the true value. It is not a 95% chance for one fixed interval.",
      "A p-value is the chance of data at least this extreme if the null hypothesis were true. It is not the chance that the null hypothesis is true.",
      "Correlation measures a linear or rank relationship, not cause. Regression residuals show how far the points are from the fitted line.",
    ],
    mistakes: [
      "Reading a small p-value as a large or important effect. Check the effect size too.",
      "Reading a confidence interval as the range where most of the data lies. It is about the mean or another estimate, not the data.",
      "Using the mean on skewed data or data with outliers. The median is steadier.",
      "Treating a correlation as a cause.",
      "Running many tests and keeping only the significant one.",
    ],
    example: "Open the central limit theorem preset. Start with a skewed population, set the sample size to 2, and see a skewed distribution of sample means. Raise the sample size to 30 and see the means form a narrow bell shape around the true mean, with the spread shrinking by about the square root of n.",
    walkthrough: [
      { title: "See a distribution", body: "Open Normal distribution and move the mean and spread, noting what stays and what changes." },
      { title: "Mean against median", body: "Open the outliers preset and watch one extreme value pull the mean while the median barely moves." },
      { title: "Sample and estimate", body: "Open Central limit theorem and then Confidence intervals; raise the sample size and watch the interval narrow." },
      { title: "Run a test", body: "Open the t-test preset, read the null and alternative, then the p-value and what it does and does not say." },
    ],
  },

  business: {
    title: "Business Analytics Lab",
    what: "Works business questions on one fixed sample business: KPI dashboards, a variance waterfall, cohorts and retention, a funnel, RFM customer segments and decision simulations. Every assumption is stated on screen.",
    how: [
      "Pick a view or a preset, such as KPI dashboard, variance waterfall, cohort table, funnel, RFM or a decision scenario.",
      "Read the stated assumptions and the definition of each metric before the numbers.",
      "Change a setting, such as price, volume, a time period or a segment, and see the numbers and chart respond.",
      "In a decision simulation, choose an action and compare the outcomes.",
      "Write down what you would recommend and which caveat you would add.",
    ],
    controls: [
      { name: "View presets", does: "Switch between KPI dashboard, variance waterfall, cohorts, funnel, RFM and decision scenarios." },
      { name: "Inputs and sliders", does: "Change drivers such as price, volume, discount or conversion and see the effect on results." },
      { name: "Metric definitions", does: "Shows how each KPI is calculated, so you can see exactly what a number means." },
      { name: "Scenario choices", does: "In a decision simulation, pick an action and see its modelled result next to the others." },
    ],
    reading: [
      "The business is a single fixed sample, so every number is Simulated. It is not real company data and it never changes unless you change an input.",
      "Assumptions are stated on screen. A result is only as good as its assumptions, so read them first.",
      "A waterfall splits a change between two periods into its causes, such as price, volume and mix, so the pieces add up to the total change.",
      "A cohort table groups customers by when they started and follows each group over time. Reading across a row shows retention for that cohort.",
      "RFM scores customers on recency, frequency and monetary value, then groups them into segments such as champions or at risk.",
    ],
    mistakes: [
      "Reporting a metric without its definition, so two people use different meanings of the same word.",
      "Treating a decision simulation as a forecast. It is a what-if on stated assumptions.",
      "Comparing averages across groups of very different sizes.",
      "Mixing a period total with a rate, such as comparing revenue in a month to revenue in a quarter.",
      "Reading a funnel drop-off as a fault. Some drop-off is normal; the question is where it is unusual.",
    ],
    example: "Open the variance waterfall. Last month's revenue and this month's differ. The bars split the change into a price effect, a volume effect and a mix effect. Raise the discount input and see the price bar shrink while the volume bar grows.",
    walkthrough: [
      { title: "Read the dashboard", body: "Open the KPI dashboard and find each metric's definition and target." },
      { title: "Explain a change", body: "Open the variance waterfall and name the biggest cause of the change." },
      { title: "Follow a cohort", body: "Open the cohort table and compare retention across start months." },
      { title: "Make a decision", body: "Open a decision scenario, choose an action and state your recommendation and its caveat." },
    ],
  },

  interview: {
    title: "Interview Walkthrough",
    what: "Walks you through an interview question the way a strong candidate would: restate the problem, try your own answer, reveal progressive hints, read an example answer and prepare for the follow-up questions.",
    how: [
      "Pick a question from the presets, grouped by topic.",
      "Read the question and write your own answer or outline first, before opening any hint.",
      "Open the hints one at a time. Stop as soon as you can continue on your own.",
      "Read the example answer and compare it with yours: what did it say that you did not?",
      "Read the follow-up questions and think about your answer to each.",
    ],
    controls: [
      { name: "Question presets", does: "Choose a question by topic: SQL, Python, Excel and Power BI, statistics, business cases, pipeline design and behavioural." },
      { name: "Hint ladder", does: "Reveals one hint at a time, from a nudge to a near answer, so you only see what you need." },
      { name: "Example answer", does: "Shown only when you ask for it, with the reasoning, not just the result." },
      { name: "Follow-ups", does: "The questions an interviewer is likely to ask next, with notes on what they are testing." },
    ],
    reading: [
      "This is a Conceptual guide. The questions, hints and example answers are written teaching material. Nothing is generated live and nothing is graded or scored.",
      "An example answer is one good answer, not the only one. Interviewers care about your reasoning, so a different correct approach is fine.",
      "Hints go from small to large on purpose. Using fewer hints means you needed less help, not that the answer is better.",
      "Follow-up questions show what an interviewer is testing, such as edge cases, trade-offs, or how you would check your answer.",
      "Your own answer is never stored or sent anywhere.",
    ],
    mistakes: [
      "Opening the example answer before trying. You learn far more from comparing your own attempt.",
      "Memorising the example answer word for word instead of understanding why it works.",
      "Jumping to code before restating the problem and asking about edge cases.",
      "Skipping the follow-ups. Interviews are won or lost there.",
      "Answering in silence. Say your reasoning aloud, even when practising alone.",
    ],
    example: "Pick a SQL question about the top product per category. Write your query first. Open hint 1 only if you are stuck; it points to ranking within a group. Then compare your query with the example answer and read the follow-up about ties.",
    walkthrough: [
      { title: "Restate the problem", body: "Say what is being asked in your own words and list one or two edge cases." },
      { title: "Attempt it", body: "Write your answer or outline before any hint." },
      { title: "Use hints sparingly", body: "Open one hint at a time and stop once you can continue." },
      { title: "Compare and extend", body: "Read the example answer, then answer each follow-up out loud." },
    ],
  },
};

export const helpFor = (id: HelpId): HelpEntry => HELP[id];
