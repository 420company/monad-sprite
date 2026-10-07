// 表单输入框
import type { InputHTMLAttributes, LabelHTMLAttributes, TextareaHTMLAttributes } from 'react'

export function Input({ className = '', ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`ui-field min-h-12 ${className}`} {...rest} />
}

export function Textarea({ className = '', ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`ui-field min-h-[96px] resize-y ${className}`} {...rest} />
}

// 可逐页补上 htmlFor，既有调用保持兼容。
export function Label({ className = '', ...rest }: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={`ui-label ${className}`} {...rest} />
}
