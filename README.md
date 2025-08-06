# Agentic AI System, Discord Chat Analysis

A Discord bot that autonomously analyzes channel messages at regular intervals with a custom local LLM using Ollama. 
This repo has the code for the bot written in JavaScript with Discord.js, and the LLM integration written in Python. 

## Features:

- Automated Daily Analysis: Scans messages in specified channels every 24 hours
- Custom LLM Integration: Uses Ollama with your custom LLM models
- Role-Based Access Control: Restrict usage to administrators only
- Smart Message Handling: Splits long responses while preserving formatting
- Manual Triggers: Run analyses on-demand with slash commands
- Multi-Channel Support: Analyze any text channel in your server

## Files

I'll go into some more detail around each file and the function that it has

### bot.js
This file all of the code for my Discord bot. Mine was called Chat Sentiment AI Agent, and is used in a community League of Legends server called Bu: League OCE.
The bot itself is configured through Discord's Developer API, so this code can be used to run your own bot in your own server. You will just need to change the variables that are stored in
config.json, and make one on your end. https://discordjs.guide is a great place to start for getting your bot setup on Discord's side, and was a resource that I used a lot when I was figuring this out!

Some key features in this file:

- Slash commands registered in commands. This lets one test the functionality of the daily check immediately and on demand
- hasAdminPermissions ensures that only members of your server that have a particular role can send commands to the bot, for added security
- Daily checks are scheduled through a cron job, data for this can be set and modified in config.json
- processChannelMessages is where messages are read in by the bot, mutated into a format that can be passed to our LLM, and then passes it along. 
It also outputs the response after it has gone through parse_llm.py. Key point is to reverse the order of the list for our LLM, as Discord.js will read this in newest message first

### config.json
This file is not saved in the repo, as it has all the important sensititive information, like the bot's token! This is where you store all of your variables that link up our code to an actual bot, and other variables
The parameters stored in here are as follows:

- token: This is our Discord Bot's token, which allows us full access to use the bot. With this token, anyone can use the bot you have created, so make sure to add it to gitignore!
- clientId: This is the Client ID of your bot, found in the configuration at https://discord.com/developers/applications
- guildId: This is the ID of the Discord server that the bot is connected to. Right click the server in Developer mode and select "Copy Server ID" to obtain this
- sourceChannelId: This is the ID of the channel that you would like to automatically monitor. Right click the channel and select "Copy Channel ID" this time
- targetChannelId: This is the channel where the bot will output it's results to. This can be the same as the one being monitored, but I would recommend making it a private one. 
- cronSchedule: This is where we specify when and how often our check will run, in cron format. An example is "0 0 * * *", to check every day at Midnight
- adminRoleId: This is the ID of the Discord role that has access to run commands using the bot. 

### parse_llm.py
This file handles our AI integration, and is in Python as opposed to JavaScript.
Using the JSON passed to it from bot.js, this code passes the text through our local LLM, and records the output to pass back to our bot. 
It creates an Ollama instance, and sends a promomt to our custom model (defined in our modelfile). It is also adds some extra formatting to display what our bot will output. 

### modelfile
This is where we define our custom model. One can do a variety of different things here, but I have included my modelfile in this repo as it does not contain any sensitive information. 
Using this file, you can define what LLM you would like to use as a base, and set a system prompt and any parameters.

I have gone for Deepseek's r1:14b model, as it was the strongest that the GPU I own can run reasonably with other apps open at the same time! If you have the compute, more powerful 
Deepseek models will perform much better, as well as various other local models that can also be used, like qwen of Gemma.
I have also included a simple system prompt, to let our bot know it's purpose. This is used whenever our LLM takes in a question in edition to the actual prompt. It is best to keep these 
as short and simple as possible, as our LLM can get overly hung up on the system prompt if we don't. This is especially true for diluted models like deepseek-r1:14b. 
I've set temperature at 0.6, which is a middling value. This means that the bot will not be too deterministic nor too extraneous. I've also set a repeat penalty, so that the bot doesn't repeat itself. It's purpose is to summarise after all!

### testUI.py
This was more used for testing LLMs, and is not needed for the bot to function. It provides a simple chat UI to visualise prompts and see the LLM thinking, without using the terminal. When using the terminal, you cannot see the LLM think in real time, and instead have to wait and see the output. This UI makes it very easy to test the outputs of different LLMs, and tweaks made to modelfiles. 

Again, this is not required for the bot, but I thought I'd include it as a reference for how I did my testing. 

## Thanks for reading!

Thanks so much for having a look at my little project. If you'd like to learn more feel free to reach out to me via email.
