import sys
import ollama
from datetime import datetime

# This takes in the text data stored in JSON from bot.js, and puts it through our local LLM model
def process_messages(messages):
    """
    Processes messages using Ollama and custom 'discord1' model
    Returns formatted response with timestamp
    """
    if not messages:
        return "No messages to process"
    
    # Combine messages into context
    context = "\n".join([
        f"[{datetime.fromtimestamp(msg['timestamp']).isoformat()}] {msg['author']}: {msg['content']}"
        for msg in messages
    ])
    
    try:
        # Generate response using Ollama
        response = ollama.generate(
            model='discord1',
            prompt=f"Analyze these daily Discord messages and provide insights:\n\n{context}",
        )
        
        # Format final output
        return (
            f"**Daily Summary** - {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n"
            f"Processed {len(messages)} messages\n\n"
            f"{response['response'].strip()}"
        )
        
    except Exception as e:
        return f"⚠️ Error processing messages: {str(e)}"

if __name__ == "__main__":
    # Read JSON input from stdin
    input_data = sys.stdin.read()
    
    if not input_data:
        print("No input data received")
        sys.exit(1)
        
    try:
        # Parse messages (each line is a JSON object)
        messages = [eval(line) for line in input_data.splitlines()]
        result = process_messages(messages)
        print(result)
    except Exception as e:
        print(f"Error processing input: {str(e)}")
        sys.exit(1)