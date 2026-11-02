import type { Template } from "./core";

export const builtins: Template[] = [
  {
    id: "builtin-article",
    name: "Article",
    description: "A clean starting point for papers and notes.",
    builtin: true,
    content: String.raw`\documentclass[11pt]{article}
\usepackage[margin=1in]{geometry}
\usepackage{amsmath,amssymb}
\title{My Article}
\author{Your Name}
\date{\today}
\begin{document}
\maketitle
\begin{abstract}
Write your abstract here.
\end{abstract}
\section{Introduction}
Start writing here.
\end{document}
`,
  },
  {
    id: "builtin-report",
    name: "Report",
    description: "Chapters, contents, and a title page.",
    builtin: true,
    content: String.raw`\documentclass[11pt]{report}
\usepackage[margin=1in]{geometry}
\usepackage{amsmath,amssymb}
\title{Project Report}
\author{Your Name}
\date{\today}
\begin{document}
\maketitle
\tableofcontents
\chapter{Introduction}
Describe the project here.
\chapter{Results}
Present your findings here.
\end{document}
`,
  },
  {
    id: "builtin-letter",
    name: "Letter",
    description: "A simple, reusable formal letter.",
    builtin: true,
    content: String.raw`\documentclass{letter}
\signature{Your Name}
\address{Your Address}
\begin{document}
\begin{letter}{Recipient\\Address}
\opening{Dear Recipient,}
Write your letter here.
\closing{Sincerely,}
\end{letter}
\end{document}
`,
  },
];
