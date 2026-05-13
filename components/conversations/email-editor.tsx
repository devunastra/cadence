'use client'

import { useEditor, EditorContent, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import TextAlign from '@tiptap/extension-text-align'
import { Color } from '@tiptap/extension-color'
import { TextStyle } from '@tiptap/extension-text-style'
import Highlight from '@tiptap/extension-highlight'
import Superscript from '@tiptap/extension-superscript'
import Subscript from '@tiptap/extension-subscript'
import Link from '@tiptap/extension-link'
import Image from '@tiptap/extension-image'
import FontFamily from '@tiptap/extension-font-family'
import Placeholder from '@tiptap/extension-placeholder'

export function useEmailEditor(placeholder = 'Compose your email here...') {
  return useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        // Disable extensions that we register explicitly below to avoid duplicates
        // (Tiptap 3.x StarterKit includes these by default)
        // @ts-ignore - version specific configuration
        link: false,
        // @ts-ignore - version specific configuration
        underline: false,
      }),
      Underline,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      TextStyle,
      Color,
      Highlight.configure({ multicolor: true }),
      Superscript,
      Subscript,
      Link.configure({ openOnClick: false }),
      Image,
      FontFamily,
      Placeholder.configure({ placeholder }),
    ],
    editorProps: {
      attributes: {
        class: 'focus:outline-none min-h-[120px] text-sm leading-relaxed px-3 py-2',
      },
    },
  })
}

export { type Editor }

export function EmailEditor({ editor }: { editor: Editor | null }) {
  if (!editor) return null
  return (
    <div className="flex-1 overflow-y-auto email-editor-wrap" style={{ color: 'var(--color-text-primary)' }}>
      {/* Reset browser paragraph margins so Enter = single line-height, not double */}
      <style>{`.email-editor-wrap .tiptap p { margin: 0; line-height: 1.5; }`}</style>
      <EditorContent editor={editor} />
    </div>
  )
}
