#!/bin/bash

tag_context=${TAG_CONTEXT:-repo}
case "$tag_context" in
    *repo*) 
        taglist="$(git for-each-ref --sort=-v:refname --format '%(refname:lstrip=2)' | grep -E "$tagFmt")"
        tag="$(semver $taglist | tail -n 1)"

        pre_taglist="$(git for-each-ref --sort=-v:refname --format '%(refname:lstrip=2)' | grep -E "$preTagFmt")"
        pre_tag="$(semver "$pre_taglist" | tail -n 1)"
        ;;
    *branch*) 
        taglist="$(git tag --list --merged HEAD --sort=-v:refname | grep -E "$tagFmt")"
        tag="$(semver $taglist | tail -n 1)"

        pre_taglist="$(git tag --list --merged HEAD --sort=-v:refname | grep -E "$preTagFmt")"
        pre_tag=$(semver "$pre_taglist" | tail -n 1)
        ;;
    * ) echo "Unrecognised context"; exit 1;;
esac

echo $tag
