'use client';

import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Heading from '@tiptap/extension-heading';
import { useEffect } from 'react';
import { MethodologyToolbar } from './MethodologyToolbar';

interface MethodologyEditorProps {
  content: Record<string, unknown> | null;
  onChange: (html: string, json: Record<string, unknown>) => void;
  editable?: boolean;
}

export function MethodologyEditor({ content, onChange, editable = true }: MethodologyEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false, // We use our own heading extension
      }),
      Underline,
      Heading.configure({
        levels: [1, 2, 3],
      }),
    ],
    content: content || '',
    editable,
    immediatelyRender: false, // Prevents SSR hydration mismatch
    editorProps: {
      attributes: {
        class: 'prose prose-sm max-w-none focus:outline-none min-h-[200px] p-4',
      },
    },
    onUpdate: ({ editor }) => {
      const html = editor.getHTML();
      const json = editor.getJSON();
      onChange(html, json as Record<string, unknown>);
    },
  });

  // Update content when it changes externally
  useEffect(() => {
    if (editor && content) {
      const currentContent = JSON.stringify(editor.getJSON());
      const newContent = JSON.stringify(content);
      if (currentContent !== newContent) {
        editor.commands.setContent(content);
      }
    }
  }, [content, editor]);

  // Update editable state
  useEffect(() => {
    if (editor) {
      editor.setEditable(editable);
    }
  }, [editable, editor]);

  return (
    <div className="border rounded-lg overflow-hidden bg-background">
      {editable && <MethodologyToolbar editor={editor} />}
      <EditorContent
        editor={editor}
        className={editable ? '' : 'pointer-events-none'}
      />
    </div>
  );
}
