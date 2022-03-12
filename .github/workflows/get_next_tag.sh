#!/bin/bash

set -o pipefail

# get latest tag that looks like a semver (with or without v)
tag_context=${TAG_CONTEXT:-repo}
case "$tag_context" in
    *repo*)
        taglist="$(git for-each-ref --sort=-v:refname --format '%(refname:lstrip=2)' | grep -E "$tagFmt")"
        tag="$(semver $taglist | tail -n 1)"
        ;;
    *branch*)
        taglist="$(git tag --list --merged HEAD --sort=-v:refname | grep -E "$tagFmt")"
        tag="$(semver $taglist | tail -n 1)"
        ;;
esac

# if there are none, start tags at INITIAL_VERSION which defaults to 0.0.0
if [ -z "$tag" ]; then
    tag="$(jq .version metadata.json).0.0"
else
    tag="$(semver -i minor $tag)"
fi

# export env var for subsequent steps
echo "TAG=$tag" >> $GITHUB_ENV
