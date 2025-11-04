interface MarkdownRendererProps {
  content: string;
  className?: string;
}

const renderMarkdown = (markdown: string): React.ReactNode => {
    // --- FIX: Pre-process the markdown to make it more robust ---
    
    // 1. Add newlines before markdown elements (headings, lists) that are run-on
    // Example: "...some text.## Heading" -> "...some text.\n\n## Heading"
    let processedMarkdown = markdown.replace(/([.!?a-záéíóúñ])(#{1,4} )/g, '$1\n\n$2');
    
    // 2. Add newlines after colons followed by lists
    processedMarkdown = processedMarkdown.replace(/(:)(\* )/g, '$1\n$2');
    processedMarkdown = processedMarkdown.replace(/(:)(\d+\. )/g, '$1\n$2');
    
    // 3. Add a space between a lowercase letter and an uppercase letter (fixes "JaponésLa" -> "Japonés La")
    processedMarkdown = processedMarkdown.replace(/([a-záéíóúñ])([A-ZÁÉÍÓÚÑ])/g, '$1 $2');
    
    // 4. Add a space between a bold-end and a new word (fixes "**Example:**He")
    processedMarkdown = processedMarkdown.replace(/\*\*([A-Za-z])/g, '** $1');
    
    // Split the content by new lines
    const lines = processedMarkdown.split('\n');
    const elements: React.ReactNode[] = [];
    let listItems: React.ReactNode[] = [];
    let isList = false;
    let listType: 'ul' | 'ol' | null = null;
    let listItemKey = 0;

    const finalizeList = () => {
        if (isList && listType) {
            const ListTag = listType;
            elements.push(<ListTag key={`list-${elements.length}`} className={`ml-4 ${listType === 'ol' ? 'list-decimal' : 'list-disc'} space-y-1`}>{listItems}</ListTag>);
        }
        listItems = [];
        isList = false;
        listType = null;
    };

    const processLine = (line: string): React.ReactNode | null => {
        line = line.trim();
        
        // --- NEW FIX: Explicitly ignore stray markdown lines ---
        if (line === "#" || line === "##" || line === "###" || line === "*") {
            return null; // This is a stray markdown character, ignore it
        }
        // --- END NEW FIX ---

        if (!line) return null;

        // Simple replacements for inline styles
        const formatText = (text: string): React.ReactNode[] => {
            // **Bold** replacement
            const boldRegex = /\*\*(.*?)\*\*/g;
            const parts = text.split(boldRegex);
            const formattedParts: React.ReactNode[] = [];

            for (let i = 0; i < parts.length; i++) {
                if (i % 2 === 1) {
                    formattedParts.push(<strong key={`${listItemKey}-b-${i}`}>{parts[i]}</strong>);
                } else {
                    formattedParts.push(parts[i]);
                }
            }
            return formattedParts;
        };

        // Headings
        if (line.startsWith('### ')) {
            finalizeList();
            return <h4 key={listItemKey} className="text-lg font-semibold text-gray-800 mt-3">{formatText(line.substring(4))}</h4>;
        }
        if (line.startsWith('## ')) {
            finalizeList();
            return <h3 key={listItemKey} className="text-xl font-bold text-gray-800 mt-4">{formatText(line.substring(3))}</h3>;
        }
        if (line.startsWith('# ')) {
            finalizeList();
            return <h2 key={listItemKey} className="text-2xl font-extrabold text-gray-900 mt-5">{formatText(line.substring(2))}</h2>;
        }

        // Lists
        let listItemText = null;
        let isNewList = false;
        let newType: 'ul' | 'ol' | null = null;

        if (line.match(/^\d+\. /)) {
            listItemText = line.substring(line.indexOf('. ') + 2).trim();
            newType = 'ol';
        } else if (line.startsWith('- ')) {
            listItemText = line.substring(2).trim();
            newType = 'ul';
        } else if (line.startsWith('* ')) { // <-- ADD THIS BLOCK
            listItemText = line.substring(2).trim();
            newType = 'ul';
        }

        if (listItemText !== null) {
            if (!isList || newType !== listType) {
                finalizeList();
                isList = true;
                listType = newType;
                isNewList = true;
            }
            listItemKey++;
            return <li key={listItemKey} className="text-gray-800">{formatText(listItemText)}</li>;
        }

        // Paragraph
        finalizeList();
        return <p key={listItemKey} className="text-gray-800 mt-2">{formatText(line)}</p>;
    };

    lines.forEach(line => {
        const element = processLine(line);
        if (element && (typeof element !== 'string' || element.trim() !== '')) {
            elements.push(element);
        }
    });

    finalizeList();

    return <>{elements}</>;
};

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content, className }) => {
  return (
    <div className={`prose prose-sm max-w-none ${className}`}>
      {renderMarkdown(content)}
    </div>
  );
};