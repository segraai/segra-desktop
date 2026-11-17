export type WelcomeStarter = {
	id: string;
	title: string;
	description: string;
	prompt: string;
};

/**
 * Starting points shown on the welcome screen in normal mode. Each prompt
 * is placed in the message box for the user to edit before sending, and
 * steers the model to the `read_document` and `write_workbook` tools.
 */
export const WELCOME_STARTERS: readonly WelcomeStarter[] = [
	{
		id: "extract-client-documents",
		title: "Extract client documents",
		description:
			"Read the slips and statements in this folder into an Excel worksheet.",
		prompt:
			"List the PDFs and images in the current folder. Read each one with the read_document tool. Then use the write_workbook tool to write one Excel workbook with an Inputs sheet that has one row per value: the document, the box or line, the amount, and the source file and page. Put the totals in as formulas. Do not calculate anything yourself. At the end, list anything you could not read or were unsure about.",
	},
	{
		id: "read-cra-notice",
		title: "Read a CRA notice",
		description: "Explain a notice and pull out the deadline and amounts.",
		prompt:
			"Ask me which file in this folder is the notice. Then read it with the read_document tool and tell me the notice type, the tax year, the amounts, the response deadline and any reference numbers. Explain the notice in plain language. Then draft a reply for me to review. Do not send anything.",
	},
	{
		id: "draft-document-request",
		title: "Draft a document request",
		description: "Write an email asking a client for what's still missing.",
		prompt:
			"Ask me which documents are still missing for this client. Then draft a short, polite email to the client that lists them. Only draft the email. Do not send it.",
	},
	{
		id: "summarize-document",
		title: "Summarize a document",
		description: "Get the key facts from a PDF or scan.",
		prompt:
			"Ask me which file in this folder to summarize. Then read it with the read_document tool and summarize the key facts. Quote amounts exactly as they are written, and give the page for each fact.",
	},
];
