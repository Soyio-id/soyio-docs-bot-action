# Soyio Docs Bot

GitHub Action to suggest documentation updates based on PR changes.

## Usage

### In GitHub Actions (Code Repos)

```yaml
# .github/workflows/docs-suggestions.yml
name: Documentation Suggestions
on:
  pull_request:
    types: [opened, synchronize]

jobs:
  suggest:
    runs-on: ubuntu-latest
    steps:
      - uses: soyio/soyio-docs-bot/bot@bot-v1
        with:
          pinecone_api_key: ${{ secrets.PINECONE_API_KEY }}
          pinecone_index: 'soyio-docs'
          gemini_api_key: ${{ secrets.GEMINI_API_KEY }}
          github_token: ${{ secrets.GITHUB_TOKEN }}
          top_k: '5'
          # Optional: add extra context for the bot (tone, audience, style)
          prompt_instruction: 'Keep suggestions concise and user-facing'
```

### Local Testing

1. **Copy `.env.example` to `.env`**
   ```bash
   cp .env.example .env
   ```

2. **Fill in your credentials**
   ```bash
   # .env
  PINECONE_API_KEY=your-key-here
  PINECONE_INDEX=soyio-docs
  GEMINI_API_KEY=your-key-here
  GEMINI_MODEL=gemini-2.5-pro
  GITHUB_TOKEN=your-token-here
  PR_NUMBER=1426
  REPO=Soyio-id/soyio
   ```

3. **Build and run**
   ```bash
   pnpm install
   pnpm run build
   pnpm start
   ```

## How It Works

1. Analyzes PR diff and metadata
2. Generates query embedding from PR context
3. Queries Pinecone for relevant documentation chunks
4. Uses Gemini to suggest documentation updates
5. Posts suggestions as PR comment

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `pinecone_api_key` | Yes | - | Pinecone API key |
| `pinecone_index` | Yes | - | Pinecone index name |
| `gemini_api_key` | Yes | - | Google Gemini API key |
| `gemini_model` | No | `gemini-2.5-pro` | Gemini model for suggestion generation |
| `github_token` | Yes | - | GitHub token for API access |
| `pr_number` | No | (auto-detected) | PR number to analyze |
| `repo` | No | (auto-detected) | Repository (owner/name) |
| `top_k` | No | `5` | Number of relevant docs to retrieve |
| `prompt_instruction` | No | - | Tone/audience guidance for the PR comment intro (doc text follows the tone/style of the supplied docs) |

> Model names can be given without the `models/` prefix; the Action adds it when calling Gemini.

## Outputs

| Output | Description |
|--------|-------------|
| `suggestions_count` | Number of suggestions generated |
| `impact_level` | Impact level (none, low, medium, high) |

## License

MIT
