const { Client, GatewayIntentBits, SlashCommandBuilder, Routes } = require('discord.js');
const { REST } = require('@discordjs/rest');
const { exec } = require('child_process');
const cron = require('node-cron');

// Load configuration
const config = require('./config.json');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// Register slash command
const commands = [
  new SlashCommandBuilder()
    .setName('run-daily-check')
    .setDescription('Run daily message processing manually')
    .toJSON(),
  new SlashCommandBuilder()
    .setName('custom-analysis')
    .setDescription('Analyze messages in a specific channel and time range')
    .addChannelOption(option =>
      option.setName('channel')
        .setDescription('Channel to analyze')
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName('start')
        .setDescription('Start date (YYYY-MM-DD)')
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName('end')
        .setDescription('End date (YYYY-MM-DD)')
        .setRequired(false)
    )
    .toJSON()
];

const rest = new REST({ version: '10' }).setToken(config.token);


client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}!`);
  
  try {
    await rest.put(
      Routes.applicationGuildCommands(config.clientId, config.guildId),
      { body: commands }
    );
    console.log('Slash command registered successfully!');
  } catch (error) {
    console.error('Error registering command:', error);
  }

  // Schedule daily job
  cron.schedule(config.cronSchedule || '0 0 * * *', () => {
    console.log('Running scheduled daily scan...');
    processChannelMessages();
  });
});

function hasAdminPermission(user) {
  if (!config.adminRoleId) {
    console.error('Admin role ID not configured!');
    return false;
  }
  
  const member = client.guilds.cache.get(config.guildId)?.members.cache.get(user.id);
  return member?.roles.cache.has(config.adminRoleId);
}

// Handle slash commands
client.on('interactionCreate', async interaction => {
  if (!interaction.isCommand()) return;

  if (interaction.commandName === 'run-daily-check') {
    // Admin permission check
    if (!hasAdminPermission(interaction.user)) {
      return interaction.reply({
        content: '⛔ You do not have permission to use this command!',
        ephemeral: true
      });
    }
    
    await interaction.deferReply({ ephemeral: true });
    try {
      await processChannelMessages();
      await interaction.editReply('✅ Daily check completed successfully!');
    } catch (error) {
      console.error('Command error:', error);
      await interaction.editReply('❌ Error processing daily check');
    }
  }
  else if (interaction.commandName === 'custom-analysis') {
    if (!hasAdminPermission(interaction.user)) {
      return interaction.reply({
        content: '⛔ You do not have permission to use this command!',
        ephemeral: true
      });
    }
        
    await interaction.deferReply({ ephemeral: true });
    
    try {
      const channel = interaction.options.getChannel('channel');
      const startDate = interaction.options.getString('start');
      const endDateInput = interaction.options.getString('end');
      
      // Validate channel type
      if (channel.type !== 0) { // 0 = text channel
        return interaction.editReply('❌ Please select a text channel');
      }
      
      // Parse dates
      const start = new Date(`${startDate}T00:00:00`);
      const end = endDateInput 
        ? new Date(`${endDateInput}T23:59:59`)
        : new Date();
        
      // Validate dates
      if (isNaN(start)) {
        return interaction.editReply('❌ Invalid start date format. Use YYYY-MM-DD');
      }
      if (endDateInput && isNaN(end)) {
        return interaction.editReply('❌ Invalid end date format. Use YYYY-MM-DD');
      }
      if (start > new Date()) {
        return interaction.editReply('❌ Start date cannot be in the future');
      }
      
      // Process custom analysis
      await processCustomChannelMessages(
        channel, 
        start, 
        end,
        interaction
      );
      
      await interaction.editReply('✅ Analysis completed successfully!');
    } catch (error) {
      console.error('Custom analysis error:', error);
      await interaction.editReply(`❌ Error: ${error.message}`);
    }
  }  
});

// Processes the recent messages in Discord and passes it through to the Python LLM. Then outputs results in Discord via the Bot
async function processChannelMessages() {
  const channel = client.channels.cache.get(config.sourceChannelId);
  if (!channel) throw new Error('Source channel not found');
  
  const targetChannel = client.channels.cache.get(config.targetChannelId);
  if (!targetChannel) throw new Error('Target channel not found');

  try {
    console.log(`Fetching messages from ${channel.name} in chronological order...`);
    
    // Fetch messages from oldest to newest
    let messages = [];
    let lastId;
    let firstMessageInBatch = null;
    
    while (true) {
      const options = { limit: 100 };
      if (lastId) options.after = lastId;  // Changed from 'before' to 'after'
      
      const fetched = await channel.messages.fetch(options);
      if (fetched.size === 0) break;
      
      // Convert to array and sort chronologically
      const fetchedMessages = Array.from(fetched.values());
      
      // Sort the batch chronologically
      fetchedMessages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
      
      // Store the first message ID for next batch
      if (!firstMessageInBatch) {
        firstMessageInBatch = fetchedMessages[0].id;
      }
      
      // Add to our collection
      messages = messages.concat(fetchedMessages);
      
      // Update lastId to the last message in this batch
      lastId = fetchedMessages[fetchedMessages.length - 1].id;
      
      // If we've reached the current time, break
      if (fetchedMessages[fetchedMessages.length - 1].createdTimestamp > Date.now() - 1000) {
        break;
      }
    }
    
    // Now filter only messages from the last 24 hours
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    const recentMessages = messages
      .filter(msg => msg.createdTimestamp > oneDayAgo)
      .map(msg => ({
        content: msg.content,
        author: msg.author.username,
        timestamp: Math.floor(msg.createdTimestamp / 1000)
      }));

    console.log(`Found ${recentMessages.length} messages in last 24 hours`);
    
    // Log the order for verification
    if (recentMessages.length > 0) {
      console.log(`First message: ${new Date(recentMessages[0].timestamp * 1000).toISOString()} - ${recentMessages[0].content.substring(0, 30)}...`);
      console.log(`Last message: ${new Date(recentMessages[recentMessages.length - 1].timestamp * 1000).toISOString()} - ${recentMessages[recentMessages.length - 1].content.substring(0, 30)}...`);
    }

    if (recentMessages.length === 0) {
      return targetChannel.send('No messages found in the last 24 hours.');
    }

    // Prepare input for Python script (JSONL format)
    const inputText = recentMessages
      .map(msg => JSON.stringify(msg))
      .join('\n');
    
    console.log('Executing Python script with Ollama integration...');
    console.log('Sample messages:');
recentMessages.slice(0, 3).forEach((msg, i) => {
  console.log(`[${i}] ${new Date(msg.timestamp * 1000).toISOString()} ${msg.author}: ${msg.content.substring(0, 20)}...`);
});
    
    // Execute Python script
  const pythonProcess = exec(
    `python parse_llm.py`,
    (error, stdout, stderr) => {
      if (error) {
        console.error(`Python Error: ${error.message}`);
        return targetChannel.send('❌ Error processing messages with Ollama');
      }
      if (stderr) console.error(`Python stderr: ${stderr}`);
      
      // Process output
      const output = stdout.trim();
      console.log(`Python output length: ${output.length} characters`);
      
      if (output.length > 0) {
        // Split long messages intelligently
        const MAX_CHUNK_SIZE = 2000;
        const chunks = [];
        let currentChunk = "";
        let inCodeBlock = false;
        let language = "";

        // Helper function to finalize current chunk
        const finalizeChunk = () => {
          if (currentChunk.trim().length > 0) {
            chunks.push(currentChunk);
            currentChunk = "";
          }
        };

        // Split output into chunks while preserving code blocks
        for (const line of output.split('\n')) {
          // Check for code block markers
          if (line.startsWith("```")) {
            if (inCodeBlock) {
              // End of code block
              currentChunk += line + '\n';
              finalizeChunk();
              inCodeBlock = false;
              continue;
            } else {
              // Start of new code block
              inCodeBlock = true;
              language = line.substring(3).trim() || "";
            }
          }

          // Check if adding line would exceed limit
          if (currentChunk.length + line.length + 1 > MAX_CHUNK_SIZE) {
            // If we're in a code block, try to split at logical points
            if (inCodeBlock && currentChunk.includes('\n')) {
              // Split at last complete code line
              const lastNewline = currentChunk.lastIndexOf('\n');
              chunks.push(currentChunk.substring(0, lastNewline + 1));
              currentChunk = currentChunk.substring(lastNewline + 1) + line + '\n';
            } else {
              // Just split wherever we are
              finalizeChunk();
              currentChunk = line + '\n';
            }
          } else {
            currentChunk += line + '\n';
          }
        }

        // Add any remaining content
        finalizeChunk();

        // Send all chunks with proper formatting
        for (let i = 0; i < chunks.length; i++) {
          let chunk = chunks[i];
          
          // Add continuation markers for multi-part messages
          if (chunks.length > 1) {
            chunk = `**Part ${i+1}/${chunks.length}**\n${chunk}`;
          }
          
          // Add code block markers if needed
          if (inCodeBlock && i === chunks.length - 1) {
            chunk += `\n\`\`\`${language}`;
          }
          
          targetChannel.send(chunk);
        }
      } else {
        targetChannel.send('⚠️ No output received from Python script');
      }
    }
    );

    // Send data to Python stdin
    pythonProcess.stdin.write(inputText);
    pythonProcess.stdin.end();

  } catch (error) {
    console.error('Error in processChannelMessages:', error);
    targetChannel.send(`❌ Critical error: ${error.message}`);
    throw error;
  }
}

// This method functions the same as the one above, but has a custom source channel and start/end times
async function processCustomChannelMessages(channel, startTime, endTime, interaction) {
  try {
    const targetChannel = client.channels.cache.get(config.targetChannelId);
    if (!targetChannel) throw new Error('Target channel not found');

    console.log(`Fetching messages from ${channel.name} between ${startTime.toISOString()} and ${endTime.toISOString()}`);
    
    // Fetch messages from oldest to newest
    let messages = [];
    let lastId;
    
    while (true) {
      const options = { limit: 100 };
      if (lastId) options.after = lastId;
      
      const fetched = await channel.messages.fetch(options);
      if (fetched.size === 0) break;
      
      // Convert to array and sort chronologically
      const fetchedMessages = Array.from(fetched.values());
      fetchedMessages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
      
      // Add to collection
      messages = messages.concat(fetchedMessages);
      
      // Update lastId to the last message in this batch
      lastId = fetchedMessages[fetchedMessages.length - 1].id;
      
      // Check if we've passed the end time
      if (fetchedMessages[fetchedMessages.length - 1].createdTimestamp > endTime.getTime()) {
        break;
      }
    }
    
    // Filter messages within time range
    const filteredMessages = messages.filter(msg => 
      msg.createdTimestamp >= startTime.getTime() && 
      msg.createdTimestamp <= endTime.getTime()
    );

    console.log(`Found ${filteredMessages.length} messages in specified range`);
    
    if (filteredMessages.length === 0) {
      return targetChannel.send(`No messages found in ${channel.name} between ${startTime.toDateString()} and ${endTime.toDateString()}`);
    }

    // Format messages for Python
    const formattedMessages = filteredMessages.map(msg => ({
      content: msg.content,
      author: msg.author.username,
      timestamp: Math.floor(msg.createdTimestamp / 1000)
    }));

    // Prepare input for Python script
    const inputText = formattedMessages
      .map(msg => JSON.stringify(msg))
      .join('\n');
    
    console.log('Executing Python script with custom range...');
    
    // Execute Python script
const pythonProcess = exec(
  `python parse_llm.py`,
  (error, stdout, stderr) => {
    if (error) {
      console.error(`Python Error: ${error.message}`);
      return targetChannel.send('❌ Error processing messages with Ollama');
    }
    if (stderr) console.error(`Python stderr: ${stderr}`);
    
    const output = stdout.trim();
    console.log(`Python output length: ${output.length} characters`);
    
    if (output.length > 0) {
      // Split output into Discord-friendly chunks
      const MAX_CHUNK_SIZE = 2000;
      const totalChunks = Math.ceil(output.length / MAX_CHUNK_SIZE);
      let currentChunk = 0;

      for (let i = 0; i < output.length; i += MAX_CHUNK_SIZE) {
        currentChunk++;
        const chunk = output.substring(i, Math.min(output.length, i + MAX_CHUNK_SIZE));
        const isLastChunk = currentChunk === totalChunks;

        if (isLastChunk) {
          // Include embed only in the final chunk
          targetChannel.send({
            content: chunk,
            embeds: [{
              title: `Analysis of #${channel.name}`,
              description: `From ${startTime.toDateString()} to ${endTime.toDateString()}`,
              color: 0x3498db
            }]
          });
        } else {
          // Send without embed for non-final chunks
          targetChannel.send(chunk);
        }
      }
    } else {
      targetChannel.send('⚠️ No output received from Python script');
    }
  }
);

    pythonProcess.stdin.write(inputText);
    pythonProcess.stdin.end();

  } catch (error) {
    console.error('Custom analysis error:', error);
    throw error;
  }
}

client.login(config.token);