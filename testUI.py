import tkinter as tk
from tkinter import scrolledtext, ttk
import requests
import json
import threading

MODEL = "discord1" #This is the custom model that I'll be using

class OllamaChatUI:
    def __init__(self, main):
        self.master = main
        main.title("Custom local LLM")
        
        # Configure window size
        main.geometry("800x600")
        
        # Create main container
        self.main_frame = ttk.Frame(main)
        self.main_frame.pack(fill=tk.BOTH, expand=True, padx=10, pady=10)
        
        # Create conversation display
        self.conversation = scrolledtext.ScrolledText(
            self.main_frame, 
            wrap=tk.WORD,
            state='disabled'
        )
        self.conversation.pack(fill=tk.BOTH, expand=True, pady=(0,10))
        
        # Create input container
        self.input_frame = ttk.Frame(self.main_frame)
        self.input_frame.pack(fill=tk.X)
        
        # Create input field
        self.user_input = ttk.Entry(self.input_frame)
        self.user_input.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=(0,5))
        self.user_input.bind("<Return>", lambda event: self.send_prompt())
        
        # Create send button
        self.send_button = ttk.Button(
            self.input_frame,
            text="Send",
            command=self.send_prompt
        )
        self.send_button.pack(side=tk.RIGHT)
        
        # Track AI response state
        self.ai_response_active = False
        self.ai_response_end = None
        
    def update_conversation(self, text, is_user=True):
        self.conversation.config(state='normal')
        prefix = "You: " if is_user else "AI: "
        self.conversation.insert(tk.END, f"{prefix}{text}\n\n")
        self.conversation.config(state='disabled')
        self.conversation.see(tk.END)
    
    def start_ai_response(self):
        self.conversation.config(state='normal')
        self.conversation.insert(tk.END, "AI: ")
        self.ai_response_active = True
        self.ai_response_end = self.conversation.index(tk.END)
        self.conversation.config(state='disabled')
        self.conversation.see(tk.END)
        
    def stream_ai_response(self, text):
        if self.ai_response_active:
            self.conversation.config(state='normal')
            self.conversation.insert(self.ai_response_end, text)
            self.ai_response_end = self.conversation.index(tk.END)
            self.conversation.config(state='disabled')
            self.conversation.see(tk.END)
        
    def end_ai_response(self):
        self.conversation.config(state='normal')
        self.conversation.insert(tk.END, "\n\n")
        self.conversation.config(state='disabled')
        self.ai_response_active = False
        self.conversation.see(tk.END)
        
    def send_prompt(self):
        prompt = self.user_input.get().strip()
        if not prompt:
            return
            
        self.user_input.delete(0, tk.END)
        self.update_conversation(prompt, is_user=True)
        
        try:
            self.send_button.config(state=tk.DISABLED)
            
            # Start streaming in a separate thread
            threading.Thread(
                target=self.stream_response,
                args=(prompt,),
                daemon=True
            ).start()
            
        except Exception as e:
            self.update_conversation(f"Error: {str(e)}", is_user=False)
            self.send_button.config(state=tk.NORMAL)
    
    def stream_response(self, prompt):
        try:
            response = requests.post(
                'http://localhost:11434/api/generate',
                json={
                    'model': MODEL,
                    'prompt': prompt,
                    'stream': True
                },
                stream=True
            )
            
            # Start AI response section
            self.master.after(0, self.start_ai_response)
            
            for line in response.iter_lines():
                if line:
                    chunk = json.loads(line.decode('utf-8'))
                    if 'response' in chunk:
                        self.master.after(0, self.stream_ai_response, chunk['response'])
                    if chunk.get('done', False):
                        self.master.after(0, self.end_ai_response)
                        
        except Exception as e:
            self.master.after(0, self.update_conversation, f"Error: {str(e)}", False)
        finally:
            self.master.after(0, lambda: self.send_button.config(state=tk.NORMAL))

if __name__ == "__main__":
    root = tk.Tk()
    app = OllamaChatUI(root)
    root.mainloop()